import { DiscordGatewayPayload, DiscordUpdatePresence } from "@discordeno/bot";

export type RuntimeBotWorkerConfig = {
    id: string;
    shards: number[];
};

export type RuntimeClusterConfig = {
    id: string;
    firstShardId: number;
    lastShardId: number;
    botWorkers: RuntimeBotWorkerConfig[];
};

export type RuntimeRestConfig = {
    host: string;
    port: number;
    authorization: string;
};

export type RuntimeGatewayConfig = {
    token: string;
    intents: number;
    totalShards: number;
    firstShardId: number;
    lastShardId: number;
    shardsPerWorker: number;
    totalWorkers: number;
    spreadShardsInRoundRobin: boolean;
    resharding: {
        enabled: boolean;
        shardsFullPercentage: number;
        checkInterval: number;
    };
};

export type RuntimeSupervisorConfig = {
    cwd: string;
    rest: RuntimeRestConfig;
    gateway: RuntimeGatewayConfig;
    cluster: RuntimeClusterConfig;
};

export type BotInboundMessage =
    | {
        type: "runtime:gateway:event";
        shardId: number;
        payload: DiscordGatewayPayload;
    }
    | {
        type: "runtime:gateway:shard-info-response";
        nonce: string;
        shardId: number;
        rtt: number;
    }
    | {
        type: "runtime:shutdown";
    };

export type BotOutboundMessage =
    | {
        type: "runtime:gateway:send-payload";
        shardId: number;
        payload: unknown;
    }
    | {
        type: "runtime:gateway:edit-status";
        payload: DiscordUpdatePresence;
    }
    | {
        type: "runtime:gateway:get-shard-info";
        nonce: string;
        guildId?: string;
    }
    | {
        type: "runtime:bot:ready";
        workerId: string;
    };

export type GatewayInboundMessage =
    | {
        type: "runtime:gateway:send-payload";
        shardId: number;
        payload: unknown;
    }
    | {
        type: "runtime:gateway:edit-status";
        payload: DiscordUpdatePresence;
    }
    | {
        type: "runtime:gateway:get-shard-info";
        nonce: string;
        guildId?: string;
    }
    | {
        type: "runtime:shutdown";
    };

export type GatewayOutboundMessage =
    | {
        type: "runtime:gateway:event";
        shardId: number;
        payload: DiscordGatewayPayload;
    }
    | {
        type: "runtime:gateway:shard-info-response";
        nonce: string;
        shardId: number;
        rtt: number;
    }
    | {
        type: "runtime:gateway:ready";
    };
