import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SnowcordEventDefinition, SnowcordEventHandlers } from "../types/types.js";

// We use any, any here because the loader doesn't know the bot's specific properties yet.
// These will be cast to the correct types when the bot is initialized.
export const events = {} as Partial<SnowcordEventHandlers<any, any>>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip the .ts / .js extension from a filename to get the event name. */
const nameFromFile = (file: string): string =>
    path.basename(file, path.extname(file));

/** Import a module and return its default export, throwing if missing. */
const importDefault = async <T>(filePath: string): Promise<T> => {
    const mod = await import(pathToFileURL(filePath).href);
    if (mod.default === undefined) {
        throw new Error(`Event file "${filePath}" must have a default export.`);
    }
    return mod.default as T;
};

// ─── Event loader ─────────────────────────────────────────────────────────────

/**
 * Load all events from a folder, returning the partial EventHandlers object.
 *
 * ### Conventions
 * - **Flat file** `ready.ts` → event named `"ready"`.
 * - Default export can be:
 *   - the handler function itself, or
 *   - an object with an `execute` function.
 * - Files starting with `_` are skipped.
 */
export const loadEventsFromFolder = async (
    folderPath: string
): Promise<Partial<SnowcordEventHandlers<any, any>>> => {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const eventsMap: { name: keyof SnowcordEventHandlers<any, any>; handler: any }[] = [];

    for (const entry of entries) {
        // Skip private/index helpers and directories (only single events supported)
        if (entry.name.startsWith("_") || !entry.isFile()) continue;

        if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) {
            const filePath = path.resolve(folderPath, entry.name);
            const name = nameFromFile(entry.name) as keyof SnowcordEventHandlers<any, any>;
            const exported = await importDefault<
                SnowcordEventDefinition<any, any, keyof SnowcordEventHandlers<any, any>>
                | SnowcordEventHandlers<any, any>[keyof SnowcordEventHandlers<any, any>]
            >(filePath);
            const handler = typeof exported === "function" ? exported : exported.execute;

            if (typeof handler !== "function") {
                throw new Error(
                    `Event file "${filePath}" must export a function or an object with an "execute" function.`
                );
            }

            eventsMap.push({ name, handler });
        }
    }

    eventsMap.forEach(({ name, handler }) => {
        events[name] = handler;
    });

    return events;
};
