import type { TransformersDesiredProperties } from "@discordeno/bot"
import { runtimeConfig } from "./config.js"
import { createSnowcordBot } from "./core/bot.js"
import { inferDesiredPropertiesFromCommands } from "./core/desiredPropertiesAutoDetect.js"
import { pushCommands } from "./core/pushCommands.js"
import { getBotFolderPaths } from "./helpers/getBotFolderPaths.js"
import { loadCommandsFromFolder } from "./loaders/commandLoader.js"
import { loadEventsFromFolder } from "./loaders/eventLoader.js"
import { startWorkerRuntime } from "./runtime/supervisor.js"

export type SnowcordRuntimeHandle = {
    reload: () => Promise<void>;
    reloadLazy: () => Promise<void>;
    fullReload: () => Promise<void>;
    restartWorker: (workerId: string) => Promise<void>;
    restartShard: (shardId: number) => Promise<void>;
    getCounts: () => Promise<{ shard: number; worker: number; cluster: number }>;
    stop: () => Promise<void>;
};

export const launch = async (cwd: string = process.cwd()): Promise<SnowcordRuntimeHandle> => {
    if (!runtimeConfig) {
        throw new Error("Snowcord runtime config is missing. Call defineSnowcordConfig(...) in your config file.");
    }

    if (runtimeConfig.workers?.enabled) {
        return startWorkerRuntime(cwd, runtimeConfig);
    }

    const paths = await getBotFolderPaths(cwd)

    const [events, commands] = await Promise.all([
        paths.eventsPath ? loadEventsFromFolder(paths.eventsPath) : Promise.resolve({}),
        paths.commandsPath ? loadCommandsFromFolder(paths.commandsPath) : Promise.resolve([]),
    ])

    const inferredFromCommands = inferDesiredPropertiesFromCommands(commands);
    const bot = createSnowcordBot(
        runtimeConfig.intents,
        inferredFromCommands as Partial<TransformersDesiredProperties>,
        events
    )
    await pushCommands(bot, commands)

    await bot.start()

    return {
        reload: async () => {
            throw new Error("Reload is only available when workers mode is enabled.");
        },
        reloadLazy: async () => {
            throw new Error("Lazy update is only available when workers mode is enabled.");
        },
        fullReload: async () => {
            throw new Error("Full reload is only available when workers mode is enabled.");
        },
        restartWorker: async () => {
            throw new Error("Worker restart is only available when workers mode is enabled.");
        },
        restartShard: async () => {
            throw new Error("Shard restart is only available when workers mode is enabled.");
        },
        getCounts: async () => ({
            shard: 1,
            worker: 1,
            cluster: 1,
        }),
        stop: async () => {
            await bot.shutdown();
        },
    };
}
