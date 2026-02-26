import { TransformersDesiredProperties } from "@discordeno/bot";
import { LoadedCommand, SnowcordEventHandlers } from "../types/types.js";

type DesiredRoot = keyof TransformersDesiredProperties;
type DesiredPropertyName<K extends DesiredRoot> = Extract<keyof TransformersDesiredProperties[K], string>;

type InferredDesiredProperties = Partial<{
    [K in DesiredRoot]: Partial<Record<DesiredPropertyName<K>, true>>;
}>;

type SupportedEvent = keyof SnowcordEventHandlers<any, any>;

const EVENT_PRIMARY_ROOT: Partial<Record<SupportedEvent, DesiredRoot>> = {
    interactionCreate: "interaction",
    messageCreate: "message",
    messageUpdate: "message",
    channelCreate: "channel",
    channelDelete: "channel",
    channelUpdate: "channel",
    threadCreate: "channel",
    threadDelete: "channel",
    threadUpdate: "channel",
    voiceStateUpdate: "voiceState",
    guildCreate: "guild",
    guildUpdate: "guild",
    roleCreate: "role",
    roleUpdate: "role",
    guildMemberAdd: "member",
    guildMemberUpdate: "member",
    guildMemberRemove: "user",
    guildBanAdd: "user",
    guildBanRemove: "user",
    botUpdate: "user",
    inviteCreate: "invite",
    scheduledEventCreate: "scheduledEvent",
    scheduledEventUpdate: "scheduledEvent",
    scheduledEventDelete: "scheduledEvent",
    entitlementCreate: "entitlement",
    entitlementUpdate: "entitlement",
    entitlementDelete: "entitlement",
    subscriptionCreate: "subscription",
    subscriptionUpdate: "subscription",
    subscriptionDelete: "subscription",
    soundboardSoundCreate: "soundboardSound",
    soundboardSoundUpdate: "soundboardSound",
};

const IDENTIFIER = "[A-Za-z_$][\\w$]*";

const toFunctionSource = (fn: Function): string => {
    try {
        return Function.prototype.toString.call(fn);
    } catch {
        return "";
    }
};

const splitTopLevel = (input: string): string[] => {
    const parts: string[] = [];
    let current = "";
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote: "'" | "\"" | "`" | null = null;
    let escaped = false;

    for (const char of input) {
        if (quote) {
            current += char;
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === "\\") {
                escaped = true;
                continue;
            }
            if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "'" || char === "\"" || char === "`") {
            quote = char;
            current += char;
            continue;
        }

        if (char === "(") parenDepth++;
        else if (char === ")") parenDepth--;
        else if (char === "{") braceDepth++;
        else if (char === "}") braceDepth--;
        else if (char === "[") bracketDepth++;
        else if (char === "]") bracketDepth--;

        if (char === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = "";
            continue;
        }

        current += char;
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
};

const extractParameterList = (source: string): string[] => {
    const trimmed = source.trim();
    const arrowWithParens = /^(?:async\s*)?\(([\s\S]*?)\)\s*=>/.exec(trimmed);
    if (arrowWithParens) return splitTopLevel(arrowWithParens[1]);

    const arrowSingleParam = new RegExp(`^(?:async\\s*)?(${IDENTIFIER})\\s*=>`).exec(trimmed);
    if (arrowSingleParam) return [arrowSingleParam[1]];

    const fnMatch = /^function(?:\s+[^(]+)?\s*\(([\s\S]*?)\)/.exec(trimmed);
    if (fnMatch) return splitTopLevel(fnMatch[1]);

    // Object/class method syntax, e.g.:
    // async execute(interaction, { bot }) { ... }
    // execute(interaction) { ... }
    const methodMatch = /^(?:async\s+)?[A-Za-z_$][\w$]*\s*\(([\s\S]*?)\)\s*\{/.exec(trimmed);
    if (methodMatch) return splitTopLevel(methodMatch[1]);

    return [];
};

const removeDefaultValue = (param: string): string => {
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < param.length; i++) {
        const char = param[i];
        if (char === "(") parenDepth++;
        else if (char === ")") parenDepth--;
        else if (char === "{") braceDepth++;
        else if (char === "}") braceDepth--;
        else if (char === "[") bracketDepth++;
        else if (char === "]") bracketDepth--;
        else if (char === "=" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            return param.slice(0, i).trim();
        }
    }

    return param.trim();
};

const extractObjectPatternKeys = (pattern: string): string[] => {
    const trimmed = pattern.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [];

    const inner = trimmed.slice(1, -1);
    const items = splitTopLevel(inner);
    const keys: string[] = [];

    for (const item of items) {
        const normalized = removeDefaultValue(item).trim();
        if (!normalized || normalized.startsWith("...")) continue;
        if (normalized.startsWith("[")) continue;

        const colonIndex = normalized.indexOf(":");
        const key = (colonIndex === -1 ? normalized : normalized.slice(0, colonIndex)).trim();
        if (new RegExp(`^${IDENTIFIER}$`).test(key)) {
            keys.push(key);
        }
    }

    return keys;
};

const extractIdentifiersFromParam = (param: string): string[] => {
    const normalized = removeDefaultValue(param);
    if (new RegExp(`^${IDENTIFIER}$`).test(normalized)) return [normalized];
    return [];
};

const collectAccessedProperties = (source: string, identifier: string): string[] => {
    const properties = new Set<string>();
    const direct = new RegExp(`\\b${identifier}\\s*\\.\\s*(${IDENTIFIER})`, "g");
    const optional = new RegExp(`\\b${identifier}\\s*\\?\\.\\s*(${IDENTIFIER})`, "g");
    const bracket = new RegExp(`\\b${identifier}\\s*\\[\\s*['\"](${IDENTIFIER})['\"]\\s*\\]`, "g");

    for (const regex of [direct, optional, bracket]) {
        let match: RegExpExecArray | null = regex.exec(source);
        while (match) {
            properties.add(match[1]);
            match = regex.exec(source);
        }
    }

    return Array.from(properties);
};

const collectAccessedPropertyChains = (source: string, identifier: string): string[][] => {
    const chains: string[][] = [];
    const chainRegex = new RegExp(
        `\\b${identifier}\\s*(?:\\?\\.|\\.)\\s*(${IDENTIFIER})(?:\\s*(?:\\?\\.|\\.)\\s*(${IDENTIFIER}))?`,
        "g"
    );

    let match: RegExpExecArray | null = chainRegex.exec(source);
    while (match) {
        const first = match[1];
        const second = match[2];
        chains.push(second ? [first, second] : [first]);
        match = chainRegex.exec(source);
    }

    return chains;
};

const INTERACTION_NESTED_ROOTS: Partial<Record<string, DesiredRoot>> = {
    user: "user",
    member: "member",
    channel: "channel",
    guild: "guild",
    message: "message",
    role: "role",
    voiceState: "voiceState",
};

const extractRootAliasesFromInteraction = (
    source: string,
    interactionIdentifier: string
): Map<DesiredRoot, Set<string>> => {
    const aliases = new Map<DesiredRoot, Set<string>>();
    const addAlias = (root: DesiredRoot, alias: string): void => {
        const normalizedAlias = alias.trim();
        if (!new RegExp(`^${IDENTIFIER}$`).test(normalizedAlias)) return;
        const rootAliases = aliases.get(root) ?? new Set<string>();
        rootAliases.add(normalizedAlias);
        aliases.set(root, rootAliases);
    };

    for (const [key, root] of Object.entries(INTERACTION_NESTED_ROOTS) as [string, DesiredRoot][]) {
        const assignRegex = new RegExp(
            `\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*${interactionIdentifier}\\s*(?:\\?\\.|\\.)\\s*${key}\\b`,
            "g"
        );

        let match: RegExpExecArray | null = assignRegex.exec(source);
        while (match) {
            addAlias(root, match[1]);
            match = assignRegex.exec(source);
        }
    }

    const destructureRegex = new RegExp(
        `\\b(?:const|let|var)\\s*\\{([\\s\\S]*?)\\}\\s*=\\s*${interactionIdentifier}\\b`,
        "g"
    );

    let destructureMatch: RegExpExecArray | null = destructureRegex.exec(source);
    while (destructureMatch) {
        const bindings = splitTopLevel(destructureMatch[1]);
        for (const binding of bindings) {
            const normalized = removeDefaultValue(binding).trim();
            if (!normalized || normalized.startsWith("...")) continue;

            const colonIndex = normalized.indexOf(":");
            const key = (colonIndex === -1 ? normalized : normalized.slice(0, colonIndex)).trim();
            const alias = (colonIndex === -1 ? key : normalized.slice(colonIndex + 1)).trim();
            const nestedRoot = INTERACTION_NESTED_ROOTS[key];
            if (!nestedRoot) continue;
            addAlias(nestedRoot, alias);
        }
        destructureMatch = destructureRegex.exec(source);
    }

    return aliases;
};

const inferFromHandlerSource = (
    inferred: InferredDesiredProperties,
    root: DesiredRoot,
    source: string,
    firstParam: string
): void => {
    for (const key of extractObjectPatternKeys(firstParam)) {
        addInferredProperty(inferred, root, key);
    }

    for (const identifier of extractIdentifiersFromParam(firstParam)) {
        for (const property of collectAccessedProperties(source, identifier)) {
            addInferredProperty(inferred, root, property);
        }

        if (root !== "interaction") continue;

        for (const [first, second] of collectAccessedPropertyChains(source, identifier)) {
            const nestedRoot = INTERACTION_NESTED_ROOTS[first];
            if (!nestedRoot || !second) continue;
            addInferredProperty(inferred, nestedRoot, second);
        }

        const aliases = extractRootAliasesFromInteraction(source, identifier);
        for (const [nestedRoot, nestedAliases] of aliases) {
            for (const alias of nestedAliases) {
                for (const property of collectAccessedProperties(source, alias)) {
                    addInferredProperty(inferred, nestedRoot, property);
                }
            }
        }
    }
};

const isValidDesiredPropertyName = (value: string): boolean =>
    new RegExp(`^${IDENTIFIER}$`).test(value);

const addInferredProperty = (
    target: InferredDesiredProperties,
    root: DesiredRoot,
    property: string
) => {
    if (!isValidDesiredPropertyName(property)) return;
    const rootMap = (target[root] ??= {} as InferredDesiredProperties[DesiredRoot]);
    (rootMap as Record<string, true>)[property] = true;
};

export const inferDesiredPropertiesFromEvents = (
    events: Partial<SnowcordEventHandlers<any, any>>
): InferredDesiredProperties => {
    const inferred: InferredDesiredProperties = {};

    for (const [eventName, maybeHandler] of Object.entries(events) as [SupportedEvent, unknown][]) {
        if (typeof maybeHandler !== "function") continue;
        const root = EVENT_PRIMARY_ROOT[eventName];
        if (!root) continue;

        const source = toFunctionSource(maybeHandler);
        if (!source) continue;

        const params = extractParameterList(source);
        if (params.length === 0) continue;

        const firstParam = params[0].trim();
        if (!firstParam) continue;
        inferFromHandlerSource(inferred, root, source, firstParam);
    }

    return inferred;
};

const inferDesiredPropertiesFromHandlers = (
    root: DesiredRoot,
    handlers: Function[]
): InferredDesiredProperties => {
    const inferred: InferredDesiredProperties = {};

    for (const maybeHandler of handlers) {
        if (typeof maybeHandler !== "function") continue;

        const source = toFunctionSource(maybeHandler);
        if (!source) continue;

        const params = extractParameterList(source);
        if (params.length === 0) continue;

        const firstParam = params[0].trim();
        if (!firstParam) continue;
        inferFromHandlerSource(inferred, root, source, firstParam);
    }

    return inferred;
};

export const inferDesiredPropertiesFromCommands = (
    commands: LoadedCommand[]
): InferredDesiredProperties => {
    const handlers: Function[] = [];

    for (const command of commands) {
        if (typeof command.execute === "function") {
            handlers.push(command.execute as unknown as Function);
        }
        if (command.actions) {
            for (const handler of Object.values(command.actions)) {
                if (typeof handler === "function") {
                    handlers.push(handler as unknown as Function);
                }
            }
        }

        if (!command.subcommands) continue;
        for (const subcommand of Object.values(command.subcommands)) {
            if (typeof subcommand.execute === "function") {
                handlers.push(subcommand.execute as unknown as Function);
            }
            if (subcommand.actions) {
                for (const handler of Object.values(subcommand.actions)) {
                    if (typeof handler === "function") {
                        handlers.push(handler as unknown as Function);
                    }
                }
            }
        }
    }

    return inferDesiredPropertiesFromHandlers("interaction", handlers);
};

export const mergeDesiredProperties = <
    TProps extends Partial<TransformersDesiredProperties>
>(
    explicitDesiredProperties: TProps,
    inferredDesiredProperties: InferredDesiredProperties
): Partial<TransformersDesiredProperties> => {
    const merged = {
        ...explicitDesiredProperties,
    } as Record<string, Record<string, true> | undefined>;

    for (const [root, props] of Object.entries(inferredDesiredProperties) as [DesiredRoot, InferredDesiredProperties[DesiredRoot]][]) {
        if (!props) continue;

        const existingRoot = (merged[root] ??= {});
        Object.assign(existingRoot, props as Record<string, true>);
    }

    return merged as Partial<TransformersDesiredProperties>;
};
