import {
    DesiredPropertiesBehavior,
    TransformersDesiredProperties,
} from "@discordeno/bot";
import {
    Command,
    SnowcordEventDefinition,
    SnowcordEventHandlers,
    Subcommand,
} from "../types/types.js";

export const defineSnowcordCommand = <T extends Command | Subcommand>(
    command: T
): T => command;

export const defineSnowcordEvent = <
    TProps extends Partial<TransformersDesiredProperties> = Partial<TransformersDesiredProperties>,
    TBehavior extends DesiredPropertiesBehavior = DesiredPropertiesBehavior.RemoveKey,
    K extends keyof SnowcordEventHandlers<TProps, TBehavior> = keyof SnowcordEventHandlers<TProps, TBehavior>,
>(
    _event: K,
    event: SnowcordEventDefinition<TProps, TBehavior, K> | SnowcordEventHandlers<TProps, TBehavior>[K]
): SnowcordEventDefinition<TProps, TBehavior, K> =>
    typeof event === "function" ? { execute: event } : event;
