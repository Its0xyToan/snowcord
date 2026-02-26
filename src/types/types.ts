import { Bot, CompleteDesiredProperties, DesiredPropertiesBehavior, EventHandlers, TransformersDesiredProperties } from "@discordeno/bot";
import { config } from "../config.js";
import {
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    APIApplicationCommandBasicOption,
    LocalizationMap,
} from "./discord.js";

export type SnowcordInteraction = Bot<never, DesiredPropertiesBehavior.RemoveKey>["transformers"]["$inferredTypes"]["interaction"];
type SnowcordCommandInteraction = SnowcordInteraction;

/** The shared context object injected as the last argument in every event handler. */
export type SnowcordContext<
    TProps extends Partial<TransformersDesiredProperties>,
    TBehavior extends DesiredPropertiesBehavior = DesiredPropertiesBehavior.RemoveKey
> = {
    bot: Bot<CompleteDesiredProperties<TProps>, TBehavior>;
    config: typeof config;
};

export type SnowcordRuntimeContext = {
    bot: Bot<any, any>;
    config: typeof config;
};

export type SnowcordInteractionExecutor = (
    interaction: SnowcordInteraction,
    context: SnowcordRuntimeContext
) => unknown | Promise<unknown>;

/**
 * Re-maps every handler in EventHandlers so that `context` is appended
 * as the last argument, e.g.:
 *   interactionCreate: (interaction, context) => unknown
 */
export type SnowcordEventHandlers<
    TProps extends Partial<TransformersDesiredProperties>,
    TBehavior extends DesiredPropertiesBehavior = DesiredPropertiesBehavior.RemoveKey
> = {
        [K in keyof EventHandlers<CompleteDesiredProperties<TProps>, TBehavior>]: (
            ...args: [...Parameters<EventHandlers<CompleteDesiredProperties<TProps>, TBehavior>[K]>, SnowcordContext<TProps, TBehavior>]
        ) => unknown;
    };

// ─── Subcommand ───────────────────────────────────────────────────────────────

/**
 * A subcommand definition (file inside a command folder).
 * Name is derived from the filename — do not include it here.
 */
export interface Subcommand {
    /** Short description shown in Discord (1–100 chars). */
    description: string;
    /** Localized descriptions keyed by Discord locale. */
    description_localizations?: LocalizationMap;
    /** Localized names keyed by Discord locale. */
    name_localizations?: LocalizationMap;
    /**
     * The options for this subcommand.
     * Only basic option types are allowed (not SUB_COMMAND or SUB_COMMAND_GROUP).
     */
    options?: APIApplicationCommandBasicOption[];
    /** Logic executed when this subcommand is invoked. */
    execute: (
        interaction: SnowcordCommandInteraction,
        context: SnowcordRuntimeContext
    ) => unknown | Promise<unknown>;
    /** Static interaction actions (custom_id -> handler), registered at startup. */
    actions?: Record<string, SnowcordInteractionExecutor>;
}

// ─── Command ─────────────────────────────────────────────────────────────────

/**
 * A top-level CHAT_INPUT (slash) command definition.
 * Name is derived from the filename/folder name — do not include it here.
 *
 * Extends Discord's own creation payload with a `guilds` field used
 * by the loader to decide where to register the command.
 */
export interface Command extends Omit<RESTPostAPIChatInputApplicationCommandsJSONBody, "name" | "type"> {
    /**
     * Optional list of guild IDs where this command should be registered.
     * If omitted or empty, the command is registered globally.
     */
    guilds?: string[];
    /**
     * Subcommands, if this command is a folder-based group.
     * Set by the loader automatically from subdirectory contents — you
     * don't need to set this manually.
     */
    subcommands?: Record<string, Subcommand>;
    /** Logic executed when this command is invoked. */
    execute: (
        interaction: SnowcordCommandInteraction,
        context: SnowcordRuntimeContext
    ) => unknown | Promise<unknown>;
    /** Static interaction actions (custom_id -> handler), registered at startup. */
    actions?: Record<string, SnowcordInteractionExecutor>;
}

/** A loaded command with its name resolved from the filesystem. */
export interface LoadedCommand extends Command {
    name: string;
}

export type SnowcordEventDefinition<
    TProps extends Partial<TransformersDesiredProperties>,
    TBehavior extends DesiredPropertiesBehavior,
    K extends keyof SnowcordEventHandlers<TProps, TBehavior>,
> = {
    execute: SnowcordEventHandlers<TProps, TBehavior>[K];
};
