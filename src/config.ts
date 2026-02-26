import { Intents } from "@discordeno/bot";

export let runtimeConfig: SnowcordConfig | undefined

export type SnowcordShardRange = {
    start: number;
    end: number;
};

export type SnowcordBotWorkerConfig = {
    id: string;
    shards: number[] | SnowcordShardRange;
};

export type SnowcordBotWorkersMode = SnowcordBotWorkerConfig[] | number | "auto";

export type SnowcordClusterConfig = {
    id: string;
    firstShardId?: number;
    lastShardId?: number;
    botWorkers?: SnowcordBotWorkersMode;
};

export type SnowcordWorkerRuntimeConfig = {
    enabled?: boolean;
    totalShards?: number | "auto";
    shardsPerWorker?: number;
    totalWorkers?: number;
    spreadShardsInRoundRobin?: boolean;
    restPort?: number;
    restHost?: string;
    clusters?: SnowcordClusterConfig[];
    clusterId?: string;
    botWorkers?: SnowcordBotWorkersMode;
    resharding?: {
        enabled?: boolean;
        shardsFullPercentage?: number;
        checkInterval?: number;
    };
};

export type SnowcordCacheEntitiesConfig = {
    channel?: boolean;
    guild?: boolean;
    member?: boolean;
    role?: boolean;
    user?: boolean;
    default?: boolean;
};

export type SnowcordCacheConfig = {
    provider?: "memory" | "redis";
    memory?: SnowcordCacheEntitiesConfig;
    redis?: {
        url?: string;
        keyPrefix?: string;
        entities?: SnowcordCacheEntitiesConfig;
    };
};

export type SnowcordConfig = {
    intents: Intents;
    workers?: SnowcordWorkerRuntimeConfig;
    cache?: SnowcordCacheConfig;
}

export const defineSnowcordConfig = (config: SnowcordConfig) => {
    runtimeConfig = {
        ...config,
    }
}


export const config: {
    SC_BOT_TOKEN: string;
    SC_CACHE_PROVIDER: "memory" | "redis";
    SC_REDIS_URL: string;
    SC_REDIS_KEY_PREFIX: string;
} = {
    SC_BOT_TOKEN: process.env.SC_BOT_TOKEN || "",
    SC_CACHE_PROVIDER: (process.env.SC_CACHE_PROVIDER === "redis" ? "redis" : "memory"),
    SC_REDIS_URL: process.env.SC_REDIS_URL || "redis://127.0.0.1:6379",
    SC_REDIS_KEY_PREFIX: process.env.SC_REDIS_KEY_PREFIX || "snowcord:cache",
}
