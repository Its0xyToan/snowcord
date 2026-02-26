import { Bot } from "@discordeno/bot";

export type ShardInfo = {
    shardId: number;
    rtt: number;
};

export async function getShardInfoFromGuild(
    bot: Bot<any, any>,
    guildId?: bigint
): Promise<ShardInfo> {
    if (typeof process.send === "function" && typeof process.on === "function") {
        const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const result = await new Promise<ShardInfo>((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error("Timed out waiting for shard info response."));
            }, 5000);

            const onMessage = (message: unknown) => {
                if (!message || typeof message !== "object") return;
                const payload = message as {
                    type?: string;
                    nonce?: string;
                    shardId?: number;
                    rtt?: number;
                };

                if (payload.type !== "runtime:gateway:shard-info-response") return;
                if (payload.nonce !== nonce) return;

                cleanup();
                resolve({
                    shardId: payload.shardId ?? 0,
                    rtt: payload.rtt ?? -1,
                });
            };

            const cleanup = () => {
                clearTimeout(timeout);
                process.off("message", onMessage);
            };

            process.on("message", onMessage);
            process.send?.({
                type: "runtime:gateway:get-shard-info",
                nonce,
                guildId: guildId?.toString(),
            });
        });

        return result;
    }

    const shardId = guildId ? bot.gateway.calculateShardId(guildId) : 0;
    const shard = bot.gateway.shards.get(shardId);

    return {
        shardId,
        rtt: shard?.heart.rtt ?? -1,
    };
}
