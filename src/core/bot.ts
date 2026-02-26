// This is the main file for the discordeno bot

import { createBot, Intents, Bot, DesiredPropertiesBehavior, TransformersDesiredProperties, CompleteDesiredProperties } from "@discordeno/bot";
import { createRequire } from "node:module";
import { config, runtimeConfig, SnowcordCacheConfig } from "../config.js";
import { SnowcordEventHandlers } from "../types/types.js";
import { interactionCreateOverwriteEvent } from "./overwriteEvents/interactionCreate.js";
import { inferDesiredPropertiesFromEvents, mergeDesiredProperties } from "./desiredPropertiesAutoDetect.js";
import { createProxyCache } from "dd-cache-proxy"
import logger from "../logger.js";

const require = createRequire(import.meta.url);

type RedisClientLike = {
    connect: () => Promise<void>;
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<unknown>;
    del: (key: string) => Promise<unknown>;
};

const readCacheConfig = (overrides?: SnowcordCacheConfig): SnowcordCacheConfig => {
    const runtimeCache = runtimeConfig?.cache;
    const provider = overrides?.provider ?? runtimeCache?.provider ?? config.SC_CACHE_PROVIDER ?? "memory";

    return {
        provider,
        memory: overrides?.memory ?? runtimeCache?.memory,
        redis: {
            url: overrides?.redis?.url ?? runtimeCache?.redis?.url ?? config.SC_REDIS_URL,
            keyPrefix:
                overrides?.redis?.keyPrefix ??
                runtimeCache?.redis?.keyPrefix ??
                config.SC_REDIS_KEY_PREFIX,
            entities: overrides?.redis?.entities ?? runtimeCache?.redis?.entities,
        },
    };
};

const serializeJsonWithBigInt = (value: unknown): string =>
    JSON.stringify(value, (_key, fieldValue) =>
        typeof fieldValue === "bigint"
            ? { __snowcord_bigint: fieldValue.toString() }
            : fieldValue
    );

const parseJsonWithBigInt = <T>(value: string): T =>
    JSON.parse(value, (_key, fieldValue) =>
        fieldValue && typeof fieldValue === "object" && "__snowcord_bigint" in fieldValue
            ? BigInt((fieldValue as { __snowcord_bigint: string }).__snowcord_bigint)
            : fieldValue
    ) as T;

const addIdentifierPropsRecursively = (input: unknown): void => {
    if (!input || typeof input !== "object") return;

    const record = input as Record<string, unknown>;
    if (!Array.isArray(record)) {
        if (!("id" in record)) record.id = true;
        if (!("userId" in record)) record.userId = true;
        if (!("guildId" in record)) record.guildId = true;
    }

    for (const value of Object.values(record)) {
        addIdentifierPropsRecursively(value);
    }
};

const createRedisClientIfAvailable = (url: string): RedisClientLike => {
    let redisModule: any;

    try {
        redisModule = require("redis");
    } catch {
        throw new Error(
            'Cache provider is "redis" but package "redis" is not installed. Install it with: pnpm add redis'
        );
    }

    if (!redisModule?.createClient) {
        throw new Error('Installed "redis" package is invalid: missing createClient().');
    }

    const client = redisModule.createClient({ url }) as RedisClientLike & {
        on?: (event: string, handler: (error: unknown) => void) => void;
    };

    client.on?.("error", (error: unknown) => {
        logger.error("[cache] redis client error:", error);
    });

    return client;
};

const cacheKeyFromItem = (
    keyPrefix: string,
    table: "channel" | "guild" | "member" | "role" | "user",
    item: any
): string => {
    const id = item?.id;
    if (table !== "member") return `${keyPrefix}:${table}:${String(id)}`;
    return `${keyPrefix}:${table}:${String(item?.guildId)}:${String(id)}`;
};

const cacheKeyFromLookup = (
    keyPrefix: string,
    table: "channel" | "guild" | "member" | "role" | "user",
    id: bigint,
    guildId?: bigint
): string => {
    if (table !== "member") return `${keyPrefix}:${table}:${id.toString()}`;
    return `${keyPrefix}:${table}:${(guildId ?? 0n).toString()}:${id.toString()}`;
};

export const createSnowcordBot = <
    TProps extends Partial<TransformersDesiredProperties>,
    TBehavior extends DesiredPropertiesBehavior = DesiredPropertiesBehavior.RemoveKey
>(
    desiredIntents: Intents,
    desiredProperties: TProps,
    events: Partial<SnowcordEventHandlers<TProps, TBehavior>>,
    options?: {
        restProxy?: {
            baseUrl: string;
            authorization?: string;
        };
        cache?: SnowcordCacheConfig;
    }
): Bot<CompleteDesiredProperties<TProps>, TBehavior> => {
    const originalInteractionCreate = events.interactionCreate;
    const desiredPropertiesRecord = desiredProperties as Record<string, Record<string, true> | undefined>;
    desiredProperties = {
        ...desiredProperties,
        user: {
            ...(desiredPropertiesRecord.user ?? {}),
            id: true,
        },
        guild: {
            ...(desiredPropertiesRecord.guild ?? {}),
            id: true,
        },
        channel: {
            ...(desiredPropertiesRecord.channel ?? {}),
            id: true,
            guildId: true,
        },
        role: {
            ...(desiredPropertiesRecord.role ?? {}),
            id: true,
            guildId: true,
        },
        member: {
            ...(desiredPropertiesRecord.member ?? {}),
            id: true,
            guildId: true,
        },
        message: {
            ...(desiredPropertiesRecord.messages ?? {}),
            id: true,
            guildId: true
        }
    };

    const inferredDesiredProperties = inferDesiredPropertiesFromEvents(events as Partial<SnowcordEventHandlers<any, any>>);
    const mergedDesiredProperties = mergeDesiredProperties(desiredProperties, inferredDesiredProperties);
    addIdentifierPropsRecursively(mergedDesiredProperties);

    // Snowcord command runtime relies on interaction helper methods (respond/defer/edit/delete),
    // which in Discordeno require these interaction properties to be desired.
    const mergedDesiredPropertiesRecord = mergedDesiredProperties as Record<string, Record<string, true> | undefined>;
    mergedDesiredPropertiesRecord.interaction = {
        ...(mergedDesiredPropertiesRecord.interaction ?? {}),
        id: true,
        token: true,
        type: true,
        data: true,
        guildId: true,
        channelId: true,
    };

    const rawBot = createBot<TProps, TBehavior>({
        token: config.SC_BOT_TOKEN,
        intents: desiredIntents,
        desiredProperties: mergedDesiredProperties as TProps,
        events: events as any,
        rest: options?.restProxy
            ? {
                token: config.SC_BOT_TOKEN,
                proxy: {
                    baseUrl: options.restProxy.baseUrl,
                    authorization: options.restProxy.authorization,
                },
            }
            : undefined,
    });

    const selectedCache = readCacheConfig(options?.cache);
    const shouldUseRedis = selectedCache.provider === "redis";

    let redisClient: RedisClientLike | undefined;
    let redisReady: Promise<void> | undefined;

    if (shouldUseRedis) {
        const redisUrl = selectedCache.redis?.url ?? config.SC_REDIS_URL;
        redisClient = createRedisClientIfAvailable(redisUrl);
        redisReady = redisClient.connect();
    }

    const redisKeyPrefix = selectedCache.redis?.keyPrefix ?? config.SC_REDIS_KEY_PREFIX;
    const bot = createProxyCache(rawBot as any, {
        cacheInMemory: shouldUseRedis ? { default: false, ...(selectedCache.memory ?? {}) } : { default: true, ...(selectedCache.memory ?? {}) },
        cacheOutsideMemory: shouldUseRedis
            ? { default: true, ...(selectedCache.redis?.entities ?? {}) }
            : { default: false },
        setItem: shouldUseRedis
            ? async (table: any, item: any) => {
                await redisReady;
                const key = cacheKeyFromItem(redisKeyPrefix, table, item);
                await redisClient!.set(key, serializeJsonWithBigInt(item));
                return item;
            }
            : undefined,
        getItem: shouldUseRedis
            ? async (...args: any[]) => {
                await redisReady;
                const [table, id, guildId] = args as ["channel" | "guild" | "member" | "role" | "user", bigint, bigint | undefined];
                const key = cacheKeyFromLookup(redisKeyPrefix, table, id, guildId);
                const data = await redisClient!.get(key);
                return data ? parseJsonWithBigInt(data) : undefined;
            }
            : undefined,
        removeItem: shouldUseRedis
            ? async (...args: any[]) => {
                await redisReady;
                const [table, id, guildId] = args as ["channel" | "guild" | "member" | "role" | "user", bigint, bigint | undefined];
                const key = cacheKeyFromLookup(redisKeyPrefix, table, id, guildId);
                await redisClient!.del(key);
                return undefined;
            }
            : undefined,
    } as any)

    // Overwrites
    bot.events.interactionCreate = (interaction: any) =>
        interactionCreateOverwriteEvent(originalInteractionCreate, interaction, { bot, config });

    return bot as Bot<CompleteDesiredProperties<TProps>, TBehavior>;
}
