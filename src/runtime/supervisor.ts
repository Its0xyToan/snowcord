import { ChildProcess, fork } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRestManager } from "@discordeno/bot";
import { config, SnowcordBotWorkerConfig, SnowcordClusterConfig, SnowcordConfig } from "../config.js";
import { createSnowcordBot } from "../core/bot.js";
import { pushCommands } from "../core/pushCommands.js";
import { getBotFolderPaths } from "../helpers/getBotFolderPaths.js";
import { loadCommandsFromFolder } from "../loaders/commandLoader.js";
import logger from "../logger.js";
import {
    BotInboundMessage,
    BotOutboundMessage,
    GatewayInboundMessage,
    GatewayOutboundMessage,
    RuntimeBotWorkerConfig,
    RuntimeClusterConfig,
    RuntimeSupervisorConfig,
} from "./types.js";

export type WorkerRuntimeController = {
    reload: () => Promise<void>;
    reloadLazy: () => Promise<void>;
    fullReload: () => Promise<void>;
    restartWorker: (workerId: string) => Promise<void>;
    restartShard: (shardId: number) => Promise<void>;
    getCounts: () => Promise<{ shard: number; worker: number; cluster: number }>;
    stop: () => Promise<void>;
};

type RouteEventMessage = Extract<GatewayOutboundMessage, { type: "runtime:gateway:event" }>;

const killChild = (child: ChildProcess | null): Promise<void> =>
    new Promise((resolve) => {
        if (!child || child.killed || child.exitCode !== null) {
            resolve();
            return;
        }

        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
        }, 5000);

        child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
        });
        child.send?.({ type: "runtime:shutdown" });
    });

const expandShardRange = (input: number[] | { start: number; end: number }): number[] => {
    if (Array.isArray(input)) {
        const invalidShard = input.find((value) => !Number.isInteger(value) || value < 0);
        if (invalidShard !== undefined) {
            throw new Error(
                `Invalid shard id "${String(invalidShard)}" in bot worker shards array. Use non-negative integers.`
            );
        }
        return [...new Set(input)].sort((a, b) => a - b);
    }

    if (input.end < input.start) {
        throw new Error(`Invalid shard range ${input.start}-${input.end}`);
    }

    const shards: number[] = [];
    for (let shardId = input.start; shardId <= input.end; shardId += 1) {
        shards.push(shardId);
    }

    return shards;
};

const normalizeBotWorkers = (
    workers: SnowcordBotWorkerConfig[] | number | "auto" | undefined,
    firstShardId: number,
    lastShardId: number,
    clusterCount: number
): RuntimeBotWorkerConfig[] => {
    if (workers === "auto") {
        if (clusterCount !== 1) {
            throw new Error(
                'workers.botWorkers="auto" is only supported when using a single cluster.'
            );
        }

        const shardWorkers: RuntimeBotWorkerConfig[] = [];
        for (let shardId = firstShardId; shardId <= lastShardId; shardId += 1) {
            shardWorkers.push({
                id: `shard${shardId}`,
                shards: [shardId],
            });
        }
        return shardWorkers;
    }

    if (typeof workers === "number") {
        if (!Number.isInteger(workers) || workers <= 0) {
            throw new Error('workers.botWorkers as a number must be a positive integer.');
        }

        const totalShardCount = lastShardId - firstShardId + 1;
        const workerCount = workers;
        const baseSize = Math.floor(totalShardCount / workerCount);
        const remainder = totalShardCount % workerCount;

        const generatedWorkers: RuntimeBotWorkerConfig[] = [];
        let cursor = firstShardId;
        for (let index = 0; index < workerCount; index += 1) {
            const shardCountForWorker = baseSize + (index < remainder ? 1 : 0);
            const shards: number[] = [];
            for (let offset = 0; offset < shardCountForWorker; offset += 1) {
                shards.push(cursor + offset);
            }
            cursor += shardCountForWorker;
            generatedWorkers.push({
                id: `bot-${index}`,
                shards,
            });
        }

        return generatedWorkers;
    }

    if (workers && workers.length > 0) {
        return workers.map((worker) => ({
            id: worker.id,
            shards: expandShardRange(worker.shards),
        }));
    }

    const shards: number[] = [];
    for (let shardId = firstShardId; shardId <= lastShardId; shardId += 1) {
        shards.push(shardId);
    }

    return [{ id: "bot-0", shards }];
};

const normalizeCluster = (runtimeConfig: SnowcordConfig, totalShards: number): RuntimeClusterConfig => {
    const workerOptions = runtimeConfig.workers;
    const clusterList = workerOptions?.clusters;
    const clusterCount = clusterList?.length ?? 1;

    const defaultCluster: SnowcordClusterConfig = {
        id: workerOptions?.clusterId ?? "default",
        firstShardId: 0,
        lastShardId: totalShards - 1,
        botWorkers: workerOptions?.botWorkers,
    };

    const clusterIdFromEnv = process.env.SC_CLUSTER_ID;
    const configuredClusterId = workerOptions?.clusterId;
    const selectedClusterId = clusterIdFromEnv ?? configuredClusterId;

    const selectedCluster =
        (selectedClusterId ? clusterList?.find((cluster) => cluster.id === selectedClusterId) : undefined) ??
        clusterList?.[0] ??
        defaultCluster;

    const firstShardId = selectedCluster.firstShardId ?? 0;
    const lastShardId = selectedCluster.lastShardId ?? Math.max(totalShards - 1, 0);

    if (lastShardId < firstShardId) {
        throw new Error(`Cluster "${selectedCluster.id}" has invalid shard range ${firstShardId}-${lastShardId}`);
    }

    return {
        id: selectedCluster.id,
        firstShardId,
        lastShardId,
        // If cluster-level workers are not set, inherit global workers.botWorkers.
        botWorkers: normalizeBotWorkers(
            selectedCluster.botWorkers ?? workerOptions?.botWorkers,
            firstShardId,
            lastShardId,
            clusterCount
        ),
    };
};

const resolveTotalShards = async (runtimeConfig: SnowcordConfig): Promise<number> => {
    const configured = runtimeConfig.workers?.totalShards;
    if (typeof configured === "number") return configured;
    if (configured !== "auto") return 1;

    const clusterCount = runtimeConfig.workers?.clusters?.length ?? 1;
    if (clusterCount !== 1) {
        throw new Error(
            'workers.totalShards="auto" is only supported when using a single cluster.'
        );
    }

    const rest = createRestManager({
        token: config.SC_BOT_TOKEN,
    });
    const gatewayBotConfig = await rest.getGatewayBot();
    return gatewayBotConfig.shards;
};

const buildRuntimeConfig = async (cwd: string, runtimeConfig: SnowcordConfig): Promise<RuntimeSupervisorConfig> => {
    const workerOptions = runtimeConfig.workers;
    const totalShards = await resolveTotalShards(runtimeConfig);
    const cluster = normalizeCluster(runtimeConfig, totalShards);
    const restHost = workerOptions?.restHost ?? "127.0.0.1";
    const restPort = workerOptions?.restPort ?? 42071;
    const restAuthorization = crypto.randomUUID();

    return {
        cwd,
        rest: {
            host: restHost,
            port: restPort,
            authorization: restAuthorization,
        },
        gateway: {
            token: config.SC_BOT_TOKEN,
            intents: runtimeConfig.intents,
            totalShards,
            firstShardId: cluster.firstShardId,
            lastShardId: cluster.lastShardId,
            shardsPerWorker: workerOptions?.shardsPerWorker ?? 25,
            totalWorkers: workerOptions?.totalWorkers ?? 4,
            spreadShardsInRoundRobin: workerOptions?.spreadShardsInRoundRobin ?? false,
            resharding: {
                enabled: workerOptions?.resharding?.enabled ?? true,
                shardsFullPercentage: workerOptions?.resharding?.shardsFullPercentage ?? 90,
                checkInterval: workerOptions?.resharding?.checkInterval ?? 1000 * 60 * 60 * 5,
            },
        },
        cluster,
    };
};

const syncCommands = async (cwd: string, intents: number): Promise<void> => {
    const paths = await getBotFolderPaths(cwd);
    if (!paths.commandsPath) return;

    const commands = await loadCommandsFromFolder(paths.commandsPath);
    logger.info(`[command sync] found ${commands.length} command(s)`)
    const bot = createSnowcordBot(intents as any, {}, {});
    await pushCommands(bot, commands);
    logger.info(`[command sync] synced ${commands.length} command(s)`)
};

const syncCommandsInBackground = (cwd: string, intents: number): Promise<void> =>
    syncCommands(cwd, intents).catch((error) => {
        logger.error("[command sync] failed:", error);
    });

export const startWorkerRuntime = async (
    cwd: string,
    runtimeConfig: SnowcordConfig
): Promise<WorkerRuntimeController> => {
    if (!config.SC_BOT_TOKEN) {
        throw new Error("SC_BOT_TOKEN is required when workers mode is enabled.");
    }

    const runtime = await buildRuntimeConfig(cwd, runtimeConfig);
    const initialCommandSync = syncCommandsInBackground(cwd, runtimeConfig.intents);

    const botChildren = new Map<string, ChildProcess>();
    const expectedBotWorkerShutdowns = new Set<string>();
    const shardInfoRequests = new Map<string, ChildProcess>();
    const shardOwner = new Map<number, string>();
    const pendingEvents: RouteEventMessage[] = [];

    let restChild: ChildProcess | null = null;
    let gatewayChild: ChildProcess | null = null;
    let stopped = false;
    let reloading = false;
    const configuredClusterCount = runtimeConfig.workers?.clusters?.length ?? 1;

    const runtimeDir = path.dirname(fileURLToPath(import.meta.url));

    for (const worker of runtime.cluster.botWorkers) {
        for (const shardId of worker.shards) {
            shardOwner.set(shardId, worker.id);
        }
    }

    const spawnRestWorker = () => {
        const restScript = path.resolve(runtimeDir, "restProcess.js");
        restChild = fork(restScript, [], {
            cwd,
            stdio: ["inherit", "inherit", "inherit", "ipc"],
            env: {
                ...process.env,
                SC_RUNTIME_REST_ENV: JSON.stringify({
                    token: config.SC_BOT_TOKEN,
                    config: runtime.rest,
                }),
            },
        });
    };

    const flushPendingEventsForWorker = (workerId: string) => {
        const worker = botChildren.get(workerId);
        if (!worker) return;

        const keep: RouteEventMessage[] = [];
        for (const event of pendingEvents) {
            const owner = shardOwner.get(event.shardId);
            if (owner === workerId) {
                worker.send(event as BotInboundMessage);
            } else {
                keep.push(event);
            }
        }

        pendingEvents.length = 0;
        pendingEvents.push(...keep);
    };

    const spawnBotWorker = (worker: RuntimeBotWorkerConfig) => {
        const botScript = path.resolve(runtimeDir, "botProcess.js");
        const child = fork(botScript, [], {
            cwd,
            stdio: ["inherit", "inherit", "inherit", "ipc"],
            env: {
                ...process.env,
                SC_RUNTIME_BOT_ENV: JSON.stringify({
                    cwd,
                    intents: runtimeConfig.intents,
                    worker,
                    rest: runtime.rest,
                }),
            },
        });

        child.on("message", (incoming: BotOutboundMessage) => {
            if (!incoming || typeof incoming !== "object") return;

            if (incoming.type === "runtime:gateway:send-payload" || incoming.type === "runtime:gateway:edit-status") {
                gatewayChild?.send(incoming as GatewayInboundMessage);
                return;
            }

             if (incoming.type === "runtime:gateway:get-shard-info") {
                shardInfoRequests.set(incoming.nonce, child);
                gatewayChild?.send(incoming as GatewayInboundMessage);
                return;
            }

            if (incoming.type === "runtime:bot:ready") {
                flushPendingEventsForWorker(incoming.workerId);
            }
        });

        child.on("exit", (code, signal) => {
            botChildren.delete(worker.id);
            const expected = expectedBotWorkerShutdowns.has(worker.id);
            expectedBotWorkerShutdowns.delete(worker.id);
            if (!stopped) {
                if (!expected) {
                    logger.warn(`[worker] bot "${worker.id}" exited (${code ?? signal ?? "unknown"})`);
                }
                if (!expected && !reloading) {
                    setTimeout(() => {
                        if (stopped || botChildren.has(worker.id)) return;
                        logger.warn(`[worker] respawning bot "${worker.id}"`);
                        spawnBotWorker(worker);
                    }, 250);
                }
            }
        });

        botChildren.set(worker.id, child);
    };

    const restartBotWorkerById = async (workerId: string): Promise<void> => {
        const worker = runtime.cluster.botWorkers.find((currentWorker) => currentWorker.id === workerId);
        if (!worker) {
            throw new Error(`Unknown bot worker "${workerId}".`);
        }

        const child = botChildren.get(workerId);
        expectedBotWorkerShutdowns.add(workerId);
        if (child) {
            child.send({ type: "runtime:shutdown" } satisfies BotInboundMessage);
            await killChild(child);
            botChildren.delete(workerId);
        }
        spawnBotWorker(worker);
    };

    const spawnGatewayWorker = () => {
        const gatewayScript = path.resolve(runtimeDir, "gatewayProcess.js");
        gatewayChild = fork(gatewayScript, [], {
            cwd,
            stdio: ["inherit", "inherit", "inherit", "ipc"],
            env: {
                ...process.env,
                SC_RUNTIME_GATEWAY_ENV: JSON.stringify({
                    config: runtime.gateway,
                }),
            },
        });

        gatewayChild.on("message", (incoming: GatewayOutboundMessage) => {
            if (!incoming || typeof incoming !== "object") return;
            if (incoming.type === "runtime:gateway:shard-info-response") {
                const requester = shardInfoRequests.get(incoming.nonce);
                shardInfoRequests.delete(incoming.nonce);
                requester?.send(incoming as BotInboundMessage);
                return;
            }
            if (incoming.type !== "runtime:gateway:event") return;

            const workerId = shardOwner.get(incoming.shardId);
            const worker = workerId ? botChildren.get(workerId) : undefined;

            if (!worker) {
                pendingEvents.push(incoming);
                return;
            }

            worker.send(incoming as BotInboundMessage);
        });

        gatewayChild.on("exit", (code, signal) => {
            if (!stopped) {
                logger.warn(`[gateway] worker exited (${code ?? signal ?? "unknown"})`);
            }
        });
    };

    spawnRestWorker();
    for (const worker of runtime.cluster.botWorkers) {
        spawnBotWorker(worker);
    }
    spawnGatewayWorker();

    const resolvedWorkers = runtime.cluster.botWorkers
        .map((worker) =>
            worker.shards.length > 0
                ? `${worker.id}[${worker.shards[0]}-${worker.shards[worker.shards.length - 1]}]`
                : `${worker.id}[no-shards]`
        )
        .join(", ");

    logger.info(
        `[worker] runtime cluster "${runtime.cluster.id}" started (${runtime.cluster.firstShardId}-${runtime.cluster.lastShardId})`
    );
    logger.info(`[worker] bot workers: ${resolvedWorkers}`);

    void initialCommandSync;

    const reload = async () => {
        if (stopped) return;
        reloading = true;

        const commandSync = syncCommandsInBackground(cwd, runtimeConfig.intents);

        const previousChildren = [...botChildren.values()];
        for (const worker of runtime.cluster.botWorkers) {
            expectedBotWorkerShutdowns.add(worker.id);
        }
        for (const child of previousChildren) {
            child.send({ type: "runtime:shutdown" } satisfies BotInboundMessage);
        }
        await Promise.all(previousChildren.map((child) => killChild(child)));
        botChildren.clear();

        for (const worker of runtime.cluster.botWorkers) {
            spawnBotWorker(worker);
        }

        await commandSync;
        reloading = false;
    };

    const reloadLazy = async () => {
        if (stopped) return;
        reloading = true;

        await syncCommandsInBackground(cwd, runtimeConfig.intents);

        const workersInOrder = [...runtime.cluster.botWorkers].sort((a, b) => {
            const aStart = a.shards[0] ?? Number.MAX_SAFE_INTEGER;
            const bStart = b.shards[0] ?? Number.MAX_SAFE_INTEGER;
            return aStart - bStart;
        });

        for (const worker of workersInOrder) {
            await restartBotWorkerById(worker.id);
        }

        reloading = false;
    };

    const fullReload = async () => {
        if (stopped) return;
        reloading = true;

        await syncCommandsInBackground(cwd, runtimeConfig.intents);

        const previousChildren = [...botChildren.values()];
        for (const worker of runtime.cluster.botWorkers) {
            expectedBotWorkerShutdowns.add(worker.id);
        }
        for (const child of previousChildren) {
            child.send({ type: "runtime:shutdown" } satisfies BotInboundMessage);
        }
        await Promise.all(previousChildren.map((child) => killChild(child)));
        botChildren.clear();
        pendingEvents.length = 0;
        shardInfoRequests.clear();

        await killChild(gatewayChild);
        gatewayChild = null;
        await killChild(restChild);
        restChild = null;

        spawnRestWorker();
        for (const worker of runtime.cluster.botWorkers) {
            spawnBotWorker(worker);
        }
        spawnGatewayWorker();

        reloading = false;
    };

    const stop = async () => {
        if (stopped) return;
        stopped = true;

        await Promise.all([...botChildren.values()].map((child) => killChild(child)));
        botChildren.clear();
        await killChild(gatewayChild);
        await killChild(restChild);
    };

    return {
        reload,
        reloadLazy,
        fullReload,
        restartWorker: restartBotWorkerById,
        restartShard: async (shardId: number) => {
            const workerId = shardOwner.get(shardId);
            if (!workerId) {
                throw new Error(`No worker owns shard ${shardId}.`);
            }
            await restartBotWorkerById(workerId);
        },
        getCounts: async () => ({
            shard: runtime.cluster.lastShardId - runtime.cluster.firstShardId + 1,
            worker: runtime.cluster.botWorkers.length,
            cluster: configuredClusterCount,
        }),
        stop,
    };
};
