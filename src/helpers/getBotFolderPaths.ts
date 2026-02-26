import fs from "node:fs/promises";
import path from "node:path";

export type BotFolderPaths = {
    commandsPath?: string;
    eventsPath?: string;
};

const folderExists = async (folderPath: string): Promise<boolean> => {
    try {
        const stats = await fs.stat(folderPath);
        return stats.isDirectory();
    } catch {
        return false;
    }
};

export const getBotFolderPaths = async (
    cwd: string = process.cwd()
): Promise<BotFolderPaths> => {
    const botCommandsPath = path.resolve(cwd, "bot", "commands");
    const botEventsPath = path.resolve(cwd, "bot", "events");
    const rootCommandsPath = path.resolve(cwd, "commands");
    const rootEventsPath = path.resolve(cwd, "events");

    const hasBotCommands = await folderExists(botCommandsPath);
    const hasBotEvents = await folderExists(botEventsPath);
    const hasRootCommands = await folderExists(rootCommandsPath);
    const hasRootEvents = await folderExists(rootEventsPath);

    const hasAnyBot = hasBotCommands || hasBotEvents;
    const hasAnyRoot = hasRootCommands || hasRootEvents;

    if (hasAnyBot && hasAnyRoot) {
        throw new Error(
            "Both bot-prefixed and root command/event folders were found. Keep only one base: 'bot/*' or './*'."
        );
    }

    if (hasAnyBot) {
        return {
            commandsPath: hasBotCommands ? botCommandsPath : undefined,
            eventsPath: hasBotEvents ? botEventsPath : undefined,
        };
    }

    if (hasAnyRoot) {
        return {
            commandsPath: hasRootCommands ? rootCommandsPath : undefined,
            eventsPath: hasRootEvents ? rootEventsPath : undefined,
        };
    }

    return {};
};
