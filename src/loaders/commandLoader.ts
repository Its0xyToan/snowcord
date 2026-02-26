import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerRef } from "../core/interactionRefs.js";
import { Command, LoadedCommand, Subcommand } from "../types/types.js";

export const commands = new Map<string, LoadedCommand>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip the .ts / .js extension from a filename to get the command name. */
const nameFromFile = (file: string): string =>
    path.basename(file, path.extname(file));

/** Import a module and return its default export, throwing if missing. */
const importDefault = async <T>(filePath: string): Promise<T> => {
    const mod = await import(pathToFileURL(filePath).href);
    if (mod.default === undefined) {
        throw new Error(`Command file "${filePath}" must have a default export.`);
    }
    return mod.default as T;
};

const registerActions = (actions?: Record<string, (interaction: any, context: any) => unknown>): void => {
    if (!actions) return;
    for (const [customId, handler] of Object.entries(actions)) {
        if (typeof handler !== "function") continue;
        registerRef(customId, handler as any);
    }
};

// ─── Subcommand loader ───────────────────────────────────────────────────────

/**
 * Load all subcommands from a folder.
 * Each `.ts` / `.js` file inside (not prefixed with `_`) is treated as
 * one subcommand whose name comes from the filename without extension.
 */
const loadSubcommands = async (
    folderPath: string
): Promise<Record<string, Subcommand>> => {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const subcommands: Record<string, Subcommand> = {};

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!/\.(ts|js|mjs|cjs)$/.test(entry.name) || entry.name.startsWith("_")) continue;

        const filePath = path.resolve(folderPath, entry.name);
        const name = nameFromFile(entry.name);
        const subcommand = await importDefault<Subcommand>(filePath);
        subcommands[name] = subcommand;
    }

    return subcommands;
};

// ─── Command loader ───────────────────────────────────────────────────────────

/**
 * Load all commands from a folder, returning a flat `LoadedCommand[]`.
 *
 * ### Conventions
 *
 * #### Flat file → top-level command
 * ```
 * commands/
 *   ping.ts        ← default export: Command  →  name: "ping"
 *   ban.ts         ← default export: Command  →  name: "ban"
 * ```
 *
 * #### Folder → command with subcommands
 * ```
 * commands/
 *   settings/
 *     _index.ts    ← (optional) default export: Command — sets description, scope, etc.
 *     notifications.ts  ← default export: Subcommand  →  subcommand: "notifications"
 *     language.ts       ← default export: Subcommand  →  subcommand: "language"
 * ```
 * Files/folders starting with `_` are skipped for command naming.
 */
export const loadCommandsFromFolder = async (
    folderPath: string
): Promise<LoadedCommand[]> => {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const commandsMap: LoadedCommand[] = [];

    for (const entry of entries) {
        // Skip private/index helpers at the top level
        if (entry.name.startsWith("_")) continue;

        if (entry.isFile() && /\.(ts|js|mjs|cjs)$/.test(entry.name)) {
            // ── Flat file → top-level command ─────────────────────────────
            const filePath = path.resolve(folderPath, entry.name);
            const name = nameFromFile(entry.name);
            const command = await importDefault<Command>(filePath);
            const loadedCommand: LoadedCommand = {
                ...command,
                name,
            };

            if (!loadedCommand.execute) {
                loadedCommand.execute = async () => { };
            }

            registerActions(loadedCommand.actions);
            for (const subcommand of Object.values(loadedCommand.subcommands ?? {})) {
                registerActions(subcommand.actions);
            }

            commandsMap.push(loadedCommand);

        } else if (entry.isDirectory()) {
            // ── Folder → command group with subcommands ────────────────────
            const dirPath = path.resolve(folderPath, entry.name);
            const name = entry.name;

            // Optional _index.ts for top-level metadata (description, scope…)
            const indexPath = path.resolve(dirPath, "_index.ts");
            let commandMeta: Partial<Command> | null = null;
            try {
                await fs.access(indexPath);
                commandMeta = await importDefault<Partial<Command>>(indexPath);
            } catch {
                // no _index.ts — defaults will be used
            }

            const subcommands = await loadSubcommands(dirPath);
            const loadedCommand: LoadedCommand = {
                // sensible defaults, overridden by _index.ts if present
                description: `${name} commands`,
                execute: async () => { },
                ...commandMeta,
                name,
                subcommands,
            };

            if (!loadedCommand.execute) {
                loadedCommand.execute = async () => { };
            }

            registerActions(loadedCommand.actions);
            for (const subcommand of Object.values(loadedCommand.subcommands ?? {})) {
                registerActions(subcommand.actions);
            }

            commandsMap.push(loadedCommand);
        }
    }

    commandsMap.forEach((command) => {
        commands.set(command.name, command);
    });

    return commandsMap;
};
