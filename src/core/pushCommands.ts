import fs from "node:fs/promises";
import path from "node:path";
import {
    Bot,
    DesiredPropertiesBehavior,
    TransformersDesiredProperties,
} from "@discordeno/bot";
import { LoadedCommand, Subcommand } from "../types/types.js";

type DiscordCreateCommand = Parameters<
    Bot<any, any>["helpers"]["upsertGlobalApplicationCommands"]
>[0][number];

type CommandsSnapshot = {
    global: DiscordCreateCommand[];
    guilds: Record<string, DiscordCreateCommand[]>;
};

type PushCommandsResult = {
    pushed: boolean;
    pushedGuild: boolean;
    pushedGlobal: boolean;
    cachePath: string;
};

const CACHE_DIR = ".snowcord";
const CACHE_FILE = "commands.json";

const toSubcommandOption = (name: string, subcommand: Subcommand) => ({
    type: 1,
    name,
    description: subcommand.description,
    descriptionLocalizations: subcommand.description_localizations,
    nameLocalizations: subcommand.name_localizations,
    options: subcommand.options?.map((option: unknown) => toDiscordCommandOption(option)),
});

const toDiscordCommandOption = (option: any): any => {
    const mapped: Record<string, unknown> = {
        ...option,
        nameLocalizations: option.name_localizations,
        descriptionLocalizations: option.description_localizations,
        minValue: option.min_value,
        maxValue: option.max_value,
        minLength: option.min_length,
        maxLength: option.max_length,
        channelTypes: option.channel_types,
    };

    delete mapped.name_localizations;
    delete mapped.description_localizations;
    delete mapped.min_value;
    delete mapped.max_value;
    delete mapped.min_length;
    delete mapped.max_length;
    delete mapped.channel_types;

    if (Array.isArray(option.options)) {
        mapped.options = option.options.map((nested: any) =>
            toDiscordCommandOption(nested)
        );
    }

    if (Array.isArray(option.choices)) {
        mapped.choices = option.choices.map((choice: any) => {
            const converted = {
                ...choice,
                nameLocalizations: choice.name_localizations,
            };
            delete converted.name_localizations;
            return converted;
        });
    }

    return mapped;
};

const toDiscordCreateCommand = (command: LoadedCommand): DiscordCreateCommand => {
    const { guilds: _guilds, subcommands, execute: _execute, ...base } = command;
    const common = {
        type: 1,
        name: command.name,
        description: base.description,
        nameLocalizations: base.name_localizations,
        descriptionLocalizations: base.description_localizations,
        defaultMemberPermissions: base.default_member_permissions,
        dmPermission: base.dm_permission,
        nsfw: base.nsfw,
        contexts: base.contexts,
        integrationTypes: base.integration_types,
    };

    if (subcommands && Object.keys(subcommands).length > 0 && base.options?.length) {
        throw new Error(
            `Command "${command.name}" defines both "options" and "subcommands". Discord does not allow both at top level.`
        );
    }

    if (subcommands && Object.keys(subcommands).length > 0) {
        const options = Object.entries(subcommands)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, subcommand]) => toSubcommandOption(name, subcommand));

        return {
            ...common,
            options,
        } as DiscordCreateCommand;
    }

    return {
        ...common,
        options: base.options?.map((option: unknown) => toDiscordCommandOption(option)),
    } as DiscordCreateCommand;
};

const buildSnapshot = (commands: LoadedCommand[]): CommandsSnapshot => {
    const global: DiscordCreateCommand[] = [];
    const guilds: Record<string, DiscordCreateCommand[]> = {};

    for (const command of commands) {
        const discordCommand = toDiscordCreateCommand(command);
        const targetGuilds = Array.isArray(command.guilds)
            ? [...new Set(command.guilds.map((guildId) => guildId.trim()).filter(Boolean))]
            : [];

        if (targetGuilds.length === 0) {
            global.push(discordCommand);
            continue;
        }

        for (const guildId of targetGuilds) {
            if (!guilds[guildId]) guilds[guildId] = [];
            guilds[guildId].push(discordCommand);
        }
    }

    global.sort((a, b) => a.name.localeCompare(b.name));
    for (const guildCommands of Object.values(guilds)) {
        guildCommands.sort((a, b) => a.name.localeCompare(b.name));
    }

    return { global, guilds };
};

const stableObject = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(stableObject);
    }

    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        const output: Record<string, unknown> = {};
        for (const [key, val] of entries) {
            output[key] = stableObject(val);
        }
        return output;
    }

    return value;
};

const toStableJson = (value: unknown): string =>
    JSON.stringify(stableObject(value));

const readPreviousSnapshot = async (cachePath: string): Promise<CommandsSnapshot | null> => {
    try {
        const raw = await fs.readFile(cachePath, "utf8");
        const parsed = JSON.parse(raw) as
            | CommandsSnapshot
            | {
                global?: DiscordCreateCommand[];
                guild?: DiscordCreateCommand[];
            };

        if ("guilds" in parsed && parsed.guilds && typeof parsed.guilds === "object") {
            return {
                global: parsed.global ?? [],
                guilds: parsed.guilds,
            };
        }

        // Backward-compatible migration from the old snapshot format.
        return {
            global: parsed.global ?? [],
            guilds: {},
        };
    } catch {
        return null;
    }
};

export const pushCommands = async <
    TProps extends TransformersDesiredProperties,
    TBehavior extends DesiredPropertiesBehavior,
>(
    bot: Bot<TProps, TBehavior>,
    commands: LoadedCommand[]
): Promise<PushCommandsResult> => {
    const snapshot = buildSnapshot(commands);
    const cachePath = path.resolve(process.cwd(), CACHE_DIR, CACHE_FILE);
    const previousSnapshot = await readPreviousSnapshot(cachePath);

    const previousGuildsJson = previousSnapshot ? toStableJson(previousSnapshot.guilds) : null;
    const previousGlobalJson = previousSnapshot ? toStableJson(previousSnapshot.global) : null;
    const nextGuildsJson = toStableJson(snapshot.guilds);
    const nextGlobalJson = toStableJson(snapshot.global);

    const guildChanged = previousGuildsJson !== nextGuildsJson;
    const globalChanged = previousGlobalJson !== nextGlobalJson;

    if (!globalChanged && !guildChanged) {
        return {
            pushed: false,
            pushedGuild: false,
            pushedGlobal: false,
            cachePath,
        };
    }

    const previousGuildIds = new Set(Object.keys(previousSnapshot?.guilds ?? {}));
    const nextGuildIds = new Set(Object.keys(snapshot.guilds));
    const guildIdsToSync = [...new Set([...previousGuildIds, ...nextGuildIds])];

    await Promise.all(
        guildIdsToSync.map((guildId) =>
            bot.helpers.upsertGuildApplicationCommands(guildId, snapshot.guilds[guildId] ?? [])
        )
    );

    if (snapshot.global.length > 0) {
        await bot.helpers.upsertGlobalApplicationCommands(snapshot.global);
    } else if (previousSnapshot && previousSnapshot.global.length > 0) {
        await bot.helpers.upsertGlobalApplicationCommands([]);
    }
    

    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    return {
        pushed: guildChanged || globalChanged,
        pushedGuild: guildChanged,
        pushedGlobal: globalChanged,
        cachePath,
    };
};
