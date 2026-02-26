import { DiscordGatewayPayload, TransformersDesiredProperties } from "@discordeno/bot";
import { createSnowcordBot } from "../core/bot.js";
import { inferDesiredPropertiesFromCommands } from "../core/desiredPropertiesAutoDetect.js";
import { getBotFolderPaths } from "../helpers/getBotFolderPaths.js";
import { loadCommandsFromFolder } from "../loaders/commandLoader.js";
import { loadEventsFromFolder } from "../loaders/eventLoader.js";
import logger from "../logger.js";
import { LoadedCommand } from "../types/types.js";
import { BotInboundMessage, BotOutboundMessage, RuntimeBotWorkerConfig, RuntimeRestConfig } from "./types.js";

type BotWorkerEnv = {
    cwd: string;
    intents: number;
    worker: RuntimeBotWorkerConfig;
    rest: RuntimeRestConfig;
};

const readEnv = (): BotWorkerEnv => {
    const raw = process.env.SC_RUNTIME_BOT_ENV;
    if (!raw) {
        throw new Error("Missing SC_RUNTIME_BOT_ENV");
    }
    return JSON.parse(raw) as BotWorkerEnv;
};

const main = async (): Promise<void> => {
    const env = readEnv();
    const shardSet = new Set<number>(env.worker.shards);
    const paths = await getBotFolderPaths(env.cwd);

    const [events, loadedCommands] = await Promise.all([
        paths.eventsPath ? loadEventsFromFolder(paths.eventsPath) : Promise.resolve({}),
        paths.commandsPath ? loadCommandsFromFolder(paths.commandsPath) : Promise.resolve([] as LoadedCommand[]),
    ]);

    const loadedEventsCount = Object.keys(events).length;
    logger.info(
        `[worker] bot "${env.worker.id}" loaded ${loadedCommands.length} command(s) and ${loadedEventsCount} event handler(s)`
    );

    const inferredFromCommands = inferDesiredPropertiesFromCommands(loadedCommands);
    const bot = createSnowcordBot(env.intents as any, inferredFromCommands as Partial<TransformersDesiredProperties>, events, {
        restProxy: {
            baseUrl: `http://${env.rest.host}:${env.rest.port}`,
            authorization: env.rest.authorization,
        },
    });

    bot.gateway.sendPayload = async (shardId: number, payload: unknown) => {
        const outbound: BotOutboundMessage = {
            type: "runtime:gateway:send-payload",
            shardId,
            payload,
        };
        process.send?.(outbound);
    };

    bot.gateway.editBotStatus = async (payload) => {
        const outbound: BotOutboundMessage = {
            type: "runtime:gateway:edit-status",
            payload,
        };
        process.send?.(outbound);
    };

    process.send?.({
        type: "runtime:bot:ready",
        workerId: env.worker.id,
    } satisfies BotOutboundMessage);

    const keepAliveInterval = setInterval(() => {
        // Keeps the worker process alive between gateway IPC events.
    }, 1000 * 60 * 60);

    process.on("message", async (message: BotInboundMessage) => {
        if (!message || typeof message !== "object") return;

        if (message.type === "runtime:shutdown") {
            clearInterval(keepAliveInterval);
            process.exit(0);
        }

        if (message.type !== "runtime:gateway:event") return;
        if (!shardSet.has(message.shardId)) return;

        await handleGatewayEvent(bot, message.payload, message.shardId);
    });

    logger.info(
        `[worker] bot "${env.worker.id}" online for shards: ${env.worker.shards.join(", ")}`
    );
    logger.info(
        `[worker] bot "${env.worker.id}" event loop active; gateway is handled by dedicated gateway worker`
    );
};

const handleGatewayEvent = async (
    bot: ReturnType<typeof createSnowcordBot>,
    payload: DiscordGatewayPayload,
    shardId: number
): Promise<void> => {
    try {
        bot.events.raw?.(payload as any, shardId);

        if (!payload.t) return;

        await bot.events.dispatchRequirements?.(payload as any, shardId);
        await (bot.handlers as Record<string, ((botRef: typeof bot, incoming: DiscordGatewayPayload, shard: number) => unknown) | undefined>)[
            payload.t
        ]?.(bot, payload, shardId);
    } catch (error) {
        logger.error(
            `[worker] bot failed while handling gateway payload ${payload.t ?? "UNKNOWN"} on shard ${shardId}:`,
            error
        );
    }
};

void main().catch((error) => {
    logger.error("[worker] bot failed:", error);
    process.exit(1);
});
