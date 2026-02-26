#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import readline from "node:readline";
import { buildSnowcordProject } from "./core/buildProject.js";
import logger from "./logger.js";

type CliCommand = "start" | "dev" | "build";
type RuntimeActionMessage =
    | { type: "snowcord:reload"; requestId: string }
    | { type: "snowcord:reload-lazy"; requestId: string }
    | { type: "snowcord:reload-full"; requestId: string }
    | { type: "snowcord:restart-worker"; requestId: string; workerId: string }
    | { type: "snowcord:restart-shard"; requestId: string; shardId: number }
    | { type: "snowcord:count"; requestId: string };
const CONFIG_FILE_PATHS = new Set([
    "snowcord.ts",
    "snowcord.js",
    "snowcord.mjs",
    "snowcord.cjs",
    "snowcord.config.ts",
    "snowcord.config.js",
    "snowcord.config.mjs",
    "snowcord.config.cjs",
    "src/snowcord.ts",
    "src/snowcord.js",
    "src/snowcord.config.ts",
    "src/snowcord.config.js",
]);

const parseDotEnvValue = (value: string): string => {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
};

const loadEnvFile = async (cwd: string): Promise<void> => {
    const envFilePath = path.resolve(cwd, ".env");
    const exists = fs.existsSync(envFilePath);
    if (!exists) return;

    const raw = await fs.promises.readFile(envFilePath, "utf8");
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const equalsIndex = trimmed.indexOf("=");
        if (equalsIndex === -1) continue;

        const key = trimmed.slice(0, equalsIndex).trim();
        if (!key) continue;

        const value = parseDotEnvValue(trimmed.slice(equalsIndex + 1));
        process.env[key] = value;
    }
};

const parseCwd = (args: string[]): string => {
    const cwdIndex = args.findIndex((value) => value === "--cwd");
    if (cwdIndex === -1) return process.cwd();
    const provided = args[cwdIndex + 1];
    if (!provided) throw new Error("Missing value for --cwd.");
    return path.resolve(provided);
};

const killChild = (child: ChildProcess | null): Promise<void> =>
    new Promise((resolve) => {
        if (!child || child.killed || child.exitCode !== null) {
            resolve();
            return;
        }

        const timeout = setTimeout(() => {
            child.kill();
        }, 5000);

        child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
        });

        if (child.connected) {
            child.send({ type: "snowcord:shutdown" });
            return;
        }

        child.kill();
    });

const requestRuntimeAction = (child: ChildProcess, outbound: RuntimeActionMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
        if (!child.connected) {
            reject(new Error("Runtime process has no IPC channel."));
            return;
        }

        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Runtime action timed out."));
        }, 30000);

        const onMessage = (incoming: unknown) => {
            if (!incoming || typeof incoming !== "object") return;
            const payload = incoming as {
                type?: string;
                error?: string;
                requestId?: string;
                counts?: { shard?: number; worker?: number; cluster?: number };
            };

            if (payload.type === "snowcord:count:result" && payload.requestId === outbound.requestId) {
                cleanup();
                resolve(payload.counts ?? {});
                return;
            }

            if (payload.type === "snowcord:action:ok" && payload.requestId === outbound.requestId) {
                cleanup();
                resolve(undefined);
                return;
            }

            if (payload.type === "snowcord:action:error" && payload.requestId === outbound.requestId) {
                cleanup();
                reject(new Error(payload.error || "Unknown runtime action error."));
            }
        };

        const cleanup = () => {
            clearTimeout(timeout);
            child.off("message", onMessage);
        };

        child.on("message", onMessage);
        child.send(outbound);
    });

const runBuild = async (cwd: string): Promise<void> => {
    const { outputDir } = await buildSnowcordProject(cwd);
    logger.info(`[build] completed: ${outputDir}`);
};

const runStart = async (cwd: string): Promise<void> => {
    await loadEnvFile(cwd);

    let activeChild: ChildProcess | null = null;
    let activeEntryPoint: string | null = null;
    let shuttingDown = false;
    let restarting = false;
    let resolveExit: (() => void) | null = null;

    const exitPromise = new Promise<void>((resolve) => {
        resolveExit = resolve;
    });

    const spawnRuntime = (entryPoint: string): ChildProcess => {
        activeEntryPoint = entryPoint;
        const child = spawn(process.execPath, [entryPoint], {
            cwd,
            stdio: ["inherit", "inherit", "inherit", "ipc"],
        });
        child.on("exit", (code, signal) => {
            if (child !== activeChild) return;
            if (restarting) return;
            if (typeof code === "number" && code !== 0) {
                process.exitCode = code;
            }
            if (signal && !shuttingDown) {
                process.exitCode = 1;
            }
            if (!shuttingDown) {
                logger.warn("[start] runtime exited");
            }
            resolveExit?.();
        });
        return child;
    };

    const fullRestart = async () => {
        await loadEnvFile(cwd);
        restarting = true;
        try {
            if (activeChild && activeChild.exitCode === null) {
                await killChild(activeChild);
                activeChild = null;
                activeEntryPoint = null;
            }

            const { entryPoint } = await buildSnowcordProject(cwd, {
                clean: true,
                hotReload: false,
            });
            activeChild = spawnRuntime(entryPoint);
            logger.info("[start] reloaded full runtime");
        } finally {
            restarting = false;
        }
    };

    const lazyUpdate = async () => {
        await loadEnvFile(cwd);
        if (!activeChild || activeChild.exitCode !== null) {
            await fullRestart();
            return;
        }

        const { entryPoint } = await buildSnowcordProject(cwd, {
            clean: false,
            hotReload: true,
        });

        if (entryPoint !== activeEntryPoint) {
            await fullRestart();
            return;
        }

        await requestRuntimeAction(activeChild, {
            type: "snowcord:reload-lazy",
            requestId: crypto.randomUUID(),
        });
        logger.info("[start] lazy update completed");
    };

    const runTerminalCommand = async (input: string): Promise<void> => {
        const trimmed = input.trim();
        if (!trimmed) return;

        if (trimmed === "update:lazy") {
            await lazyUpdate();
            return;
        }

        if (trimmed === "update:full" || trimmed === "restart:cluster") {
            await fullRestart();
            return;
        }

        if (trimmed.startsWith("restart:worker ")) {
            if (!activeChild || activeChild.exitCode !== null) {
                logger.warn("[start] runtime is not running");
                return;
            }

            const workerId = trimmed.slice("restart:worker ".length).trim();
            if (!workerId) {
                logger.warn("[start] usage: restart:worker {workerId}");
                return;
            }

            await requestRuntimeAction(activeChild, {
                type: "snowcord:restart-worker",
                requestId: crypto.randomUUID(),
                workerId,
            });
            logger.info(`[start] restarted worker "${workerId}"`);
            return;
        }

        if (trimmed.startsWith("restart:shard ")) {
            if (!activeChild || activeChild.exitCode !== null) {
                logger.warn("[start] runtime is not running");
                return;
            }

            const rawShardId = trimmed.slice("restart:shard ".length).trim();
            const shardId = Number(rawShardId);
            if (!Number.isInteger(shardId) || shardId < 0) {
                logger.warn("[start] usage: restart:shard {shardId}");
                return;
            }

            await requestRuntimeAction(activeChild, {
                type: "snowcord:restart-shard",
                requestId: crypto.randomUUID(),
                shardId,
            });
            logger.info(`[start] restarted shard ${shardId}`);
            return;
        }

        if (trimmed === "count:shard" || trimmed === "count:worker" || trimmed === "count:cluster") {
            if (!activeChild || activeChild.exitCode !== null) {
                logger.warn("[start] runtime is not running");
                return;
            }

            const result = await requestRuntimeAction(activeChild, {
                type: "snowcord:count",
                requestId: crypto.randomUUID(),
            }) as { shard?: number; worker?: number; cluster?: number };

            if (trimmed === "count:shard") logger.info(`[count] shard: ${result.shard ?? 0}`);
            if (trimmed === "count:worker") logger.info(`[count] worker: ${result.worker ?? 0}`);
            if (trimmed === "count:cluster") logger.info(`[count] cluster: ${result.cluster ?? 0}`);
            return;
        }

        logger.info(
            "[start] commands: update:lazy | update:full | restart:shard {shardId} | restart:worker {workerId} | restart:cluster | count:shard | count:worker | count:cluster"
        );
    };

    const commandLine = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    commandLine.on("line", (line) => {
        void runTerminalCommand(line).catch((error) => {
            logger.error("[start] command failed:", error);
        });
    });

    const { entryPoint } = await buildSnowcordProject(cwd);
    activeChild = spawnRuntime(entryPoint);

    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        commandLine.close();
        await killChild(activeChild);
        resolveExit?.();
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    await exitPromise;
};

const runDev = async (cwd: string): Promise<void> => {
    await loadEnvFile(cwd);

    let activeChild: ChildProcess | null = null;
    let activeEntryPoint: string | null = null;
    let pendingRestart = false;
    let pendingFullRestart = false;
    let restarting = false;

    const shouldFullRestartForChange = (normalizedPath: string): boolean =>
        CONFIG_FILE_PATHS.has(normalizedPath);

    const spawnRuntime = (entryPoint: string): ChildProcess => {
        activeEntryPoint = entryPoint;
        const child = spawn(process.execPath, [entryPoint], {
            cwd,
            stdio: ["inherit", "inherit", "inherit", "ipc"],
        });
        child.on("exit", (code) => {
            if (typeof code === "number" && code !== 0) {
                process.exitCode = code;
            }
        });
        return child;
    };

    const restart = async (forceFullRestart = false) => {
        if (restarting) {
            pendingRestart = true;
            pendingFullRestart = pendingFullRestart || forceFullRestart;
            return;
        }

        restarting = true;
        try {
            await loadEnvFile(cwd);
            if (forceFullRestart && activeChild && activeChild.exitCode === null) {
                await killChild(activeChild);
                activeChild = null;
                activeEntryPoint = null;
            }
            const canHotReload =
                !forceFullRestart &&
                !!activeChild &&
                activeChild.exitCode === null &&
                activeEntryPoint !== null;
            const { entryPoint } = await buildSnowcordProject(cwd, {
                clean: !canHotReload,
                hotReload: canHotReload,
            });
            if (!activeChild || activeChild.exitCode !== null || activeEntryPoint !== entryPoint) {
                await killChild(activeChild);
                activeChild = spawnRuntime(entryPoint);
                logger.info(forceFullRestart ? "[dev] reloaded full runtime" : "[dev] reloaded bot workers");
                return;
            }

            try {
                await requestRuntimeAction(activeChild, {
                    type: "snowcord:reload",
                    requestId: crypto.randomUUID(),
                });
                logger.info("[dev] reloaded bot workers");
            } catch (reloadError) {
                logger.error(
                    "[dev] hot reload failed; keeping current runtime alive to avoid gateway reconnect:",
                    reloadError
                );
            }
        } catch (error) {
            logger.error("[dev] rebuild failed:", error);
        } finally {
            restarting = false;
            if (pendingRestart) {
                pendingRestart = false;
                const shouldForceFullRestart = pendingFullRestart;
                pendingFullRestart = false;
                void restart(shouldForceFullRestart);
            }
        }
    };

    await restart();

    const runTerminalCommand = async (input: string): Promise<void> => {
        const trimmed = input.trim();
        if (!trimmed) return;

        if (trimmed === "update:full" || trimmed === "restart:cluster") {
            await restart(true);
            return;
        }

        if (trimmed === "update:lazy") {
            if (!activeChild || activeChild.exitCode !== null) {
                await restart(true);
                return;
            }

            const { entryPoint } = await buildSnowcordProject(cwd, {
                clean: false,
                hotReload: true,
            });

            if (entryPoint !== activeEntryPoint) {
                await restart(true);
                return;
            }

            await requestRuntimeAction(activeChild, {
                type: "snowcord:reload-lazy",
                requestId: crypto.randomUUID(),
            });
            logger.info("[dev] lazy update completed");
            return;
        }

        if (trimmed.startsWith("restart:worker ")) {
            if (!activeChild || activeChild.exitCode !== null) {
                logger.warn("[dev] runtime is not running");
                return;
            }

            const workerId = trimmed.slice("restart:worker ".length).trim();
            if (!workerId) {
                logger.warn("[dev] usage: restart:worker {workerId}");
                return;
            }

            await requestRuntimeAction(activeChild, {
                type: "snowcord:restart-worker",
                requestId: crypto.randomUUID(),
                workerId,
            });
            logger.info(`[dev] restarted worker "${workerId}"`);
            return;
        }

        if (trimmed.startsWith("restart:shard ")) {
            if (!activeChild || activeChild.exitCode !== null) {
                logger.warn("[dev] runtime is not running");
                return;
            }

            const rawShardId = trimmed.slice("restart:shard ".length).trim();
            const shardId = Number(rawShardId);
            if (!Number.isInteger(shardId) || shardId < 0) {
                logger.warn("[dev] usage: restart:shard {shardId}");
                return;
            }

            await requestRuntimeAction(activeChild, {
                type: "snowcord:restart-shard",
                requestId: crypto.randomUUID(),
                shardId,
            });
            logger.info(`[dev] restarted shard ${shardId}`);
            return;
        }

        if (trimmed === "count:shard" || trimmed === "count:worker" || trimmed === "count:cluster") {
            if (!activeChild || activeChild.exitCode !== null) {
                logger.warn("[dev] runtime is not running");
                return;
            }

            const result = await requestRuntimeAction(activeChild, {
                type: "snowcord:count",
                requestId: crypto.randomUUID(),
            }) as { shard?: number; worker?: number; cluster?: number };

            if (trimmed === "count:shard") logger.info(`[count] shard: ${result.shard ?? 0}`);
            if (trimmed === "count:worker") logger.info(`[count] worker: ${result.worker ?? 0}`);
            if (trimmed === "count:cluster") logger.info(`[count] cluster: ${result.cluster ?? 0}`);
            return;
        }

        logger.info(
            "[dev] commands: update:lazy | update:full | restart:shard {shardId} | restart:worker {workerId} | restart:cluster | count:shard | count:worker | count:cluster"
        );
    };

    const commandLine = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    commandLine.on("line", (line) => {
        void runTerminalCommand(line).catch((error) => {
            logger.error("[dev] command failed:", error);
        });
    });

    let debounceTimer: NodeJS.Timeout | undefined;
    const watcher = fs.watch(cwd, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const normalized = filename.replace(/\\/g, "/");
        if (normalized.startsWith("node_modules/")) return;
        if (normalized === ".snowcord" || normalized.startsWith(".snowcord/")) return;
        if (normalized.startsWith(".git/")) return;

        const forceFullRestart = shouldFullRestartForChange(normalized);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            void restart(forceFullRestart);
        }, 250);
    });

    const shutdown = async () => {
        commandLine.close();
        watcher.close();
        await killChild(activeChild);
        process.exit();
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
};

const printUsage = () => {
    logger.info("Usage: snowcord <start|dev|build> [--cwd <path>]");
};

const main = async () => {
    const [, , rawCommand, ...rest] = process.argv;
    const command = rawCommand as CliCommand | undefined;
    const cwd = parseCwd(rest);

    if (!command || !["start", "dev", "build"].includes(command)) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    if (command === "build") {
        await runBuild(cwd);
        return;
    }

    if (command === "start") {
        await runStart(cwd);
        return;
    }

    await runDev(cwd);
};

void main().catch((error) => {
    logger.error("[cli] failed:", error);
    process.exitCode = 1;
});
