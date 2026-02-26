// Handle commands

import { Bot, CompleteDesiredProperties, DesiredPropertiesBehavior, TransformersDesiredProperties } from "@discordeno/bot";
import { config as ConfigFile } from "../../config.js";
import { resolveComponentExecutor, resolveModalExecutor } from "../interactionRefs.js";
import { commands } from "../../loaders/commandLoader.js";
import logger from "../../logger.js";
import { SnowcordEventHandlers } from "../../types/types.js";

export const interactionCreateOverwriteEvent = async <
    TProps extends Partial<TransformersDesiredProperties>,
    TBehavior extends DesiredPropertiesBehavior
>(
    originalHandler: SnowcordEventHandlers<TProps, TBehavior>["interactionCreate"] | undefined,
    interaction: Bot<CompleteDesiredProperties<TProps>, TBehavior>["transformers"]["$inferredTypes"]["interaction"],
    { bot, config }: { bot: Bot<CompleteDesiredProperties<TProps>, TBehavior>, config: typeof ConfigFile }
) => {
    const incomingInteraction = interaction as any;
    const interactionContext = { bot, config };

    const respondInternalError = async (): Promise<void> => {
        try {
            await (interaction as any).respond({
                content: "There was an internal error while running this interaction.",
                flags: 64,
            });
        } catch {
            // Ignore if already acknowledged or response fails.
        }
    };

    const executeWithErrorHandling = async (
        target: "command" | "component" | "modal",
        id: string,
        run: () => Promise<void>
    ): Promise<void> => {
        try {
            await run();
        } catch (error) {
            logger.error(`[interaction] ${target} "${id}" execution failed:`, error);
            await respondInternalError();
        }
    };

    const interactionCustomId = (() => {
        const customId = incomingInteraction.data?.customId ?? incomingInteraction.data?.custom_id;
        return typeof customId === "string" ? customId : undefined;
    })();

    if (incomingInteraction.type === 2) {
        const commandName = incomingInteraction.data?.name;

        if (commandName) {
            const command = commands.get(commandName);

            if (!command) {
                logger.warn(`[interaction] unknown command "${commandName}"`);
            } else {
                const firstOption = incomingInteraction.data?.options?.[0];
                const subcommandName = firstOption?.type === 1 ? firstOption.name : undefined;
                const subcommand = subcommandName ? command.subcommands?.[subcommandName] : undefined;

                await executeWithErrorHandling("command", commandName, async () => {
                    if (subcommand) {
                        await subcommand.execute(interaction as any, interactionContext);
                    } else {
                        await command.execute(interaction as any, interactionContext);
                    }
                });
            }
        }
    }

    if (incomingInteraction.type === 3 && interactionCustomId) {
        const executor = resolveComponentExecutor(interactionCustomId);
        if (executor) {
            await executeWithErrorHandling("component", interactionCustomId, async () => {
                await executor(interaction as any, interactionContext);
            });
        }
    }

    if (incomingInteraction.type === 5 && interactionCustomId) {
        const executor = resolveModalExecutor(interactionCustomId);
        if (executor) {
            await executeWithErrorHandling("modal", interactionCustomId, async () => {
                await executor(interaction as any, interactionContext);
            });
        }
    }

    await originalHandler?.(interaction, { bot, config });
};
