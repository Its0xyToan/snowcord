import { createGatewayManager, createRestManager } from "@discordeno/bot";
import type { ShardSocketRequest } from "@discordeno/bot";
import logger from "../logger.js";
import { GatewayInboundMessage, RuntimeGatewayConfig } from "./types.js";

type GatewayWorkerEnv = {
    config: RuntimeGatewayConfig;
};

const readEnv = (): GatewayWorkerEnv => {
    const raw = process.env.SC_RUNTIME_GATEWAY_ENV;
    if (!raw) {
        throw new Error("Missing SC_RUNTIME_GATEWAY_ENV");
    }
    return JSON.parse(raw) as GatewayWorkerEnv;
};

const main = async (): Promise<void> => {
    const env = readEnv();
    const rest = createRestManager({
        token: env.config.token,
    });
    const gatewayConnection = await rest.getGatewayBot();
    const expectedShardCount = env.config.lastShardId - env.config.firstShardId + 1;
    const readyShards = new Set<number>();

    const gateway = createGatewayManager({
        token: env.config.token,
        intents: env.config.intents,
        connection: gatewayConnection,
        totalShards: env.config.totalShards,
        firstShardId: env.config.firstShardId,
        lastShardId: env.config.lastShardId,
        shardsPerWorker: env.config.shardsPerWorker,
        totalWorkers: env.config.totalWorkers,
        spreadShardsInRoundRobin: env.config.spreadShardsInRoundRobin,
        resharding: {
            enabled: env.config.resharding.enabled,
            shardsFullPercentage: env.config.resharding.shardsFullPercentage,
            checkInterval: env.config.resharding.checkInterval,
            getSessionInfo: async () => await rest.getGatewayBot(),
        },
        events: {
            message: async (shard, payload) => {
                if (payload?.t === "READY" && !readyShards.has(shard.id)) {
                    readyShards.add(shard.id);
                    logger.info(
                        `[gateway] shard ${shard.id} ready (${readyShards.size}/${expectedShardCount})`
                    );
                }

                process.send?.({
                    type: "runtime:gateway:event",
                    shardId: shard.id,
                    payload,
                });
            },
        },
    });

    process.on("message", async (message: GatewayInboundMessage) => {
        if (!message || typeof message !== "object") return;

        if (message.type === "runtime:gateway:send-payload") {
            await gateway.sendPayload(message.shardId, message.payload as ShardSocketRequest);
            return;
        }

        if (message.type === "runtime:gateway:edit-status") {
            await gateway.editBotStatus(message.payload);
            return;
        }

        if (message.type === "runtime:gateway:get-shard-info") {
            const shardId = message.guildId
                ? gateway.calculateShardId(BigInt(message.guildId))
                : 0;
            const shard = gateway.shards.get(shardId);
            process.send?.({
                type: "runtime:gateway:shard-info-response",
                nonce: message.nonce,
                shardId,
                rtt: shard?.heart.rtt ?? -1,
            });
            return;
        }

        if (message.type === "runtime:shutdown") {
            await gateway.shutdown(3000, "Snowcord runtime shutdown");
            process.exit(0);
        }
    });

    logger.info(
        `[gateway] spawning ${expectedShardCount} shard(s) (${env.config.firstShardId}-${env.config.lastShardId})`
    );
    await gateway.spawnShards();
    process.send?.({ type: "runtime:gateway:ready" });
    logger.info(
        `[gateway] worker online (${gateway.firstShardId}-${gateway.lastShardId}/${gateway.totalShards})`
    );
};

void main().catch((error) => {
    logger.error("[gateway] worker failed:", error);
    process.exit(1);
});
