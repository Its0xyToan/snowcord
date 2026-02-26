import type { SnowcordInteractionExecutor } from "../types/types.js";

const REGISTRY_LIMIT = 10_000;

const componentExecutors = new Map<string, SnowcordInteractionExecutor>();
const modalExecutors = new Map<string, SnowcordInteractionExecutor>();

const setWithLimit = (
    store: Map<string, SnowcordInteractionExecutor>,
    customId: string,
    executor: SnowcordInteractionExecutor
): void => {
    if (store.has(customId)) {
        store.delete(customId);
    }
    store.set(customId, executor);

    if (store.size <= REGISTRY_LIMIT) return;

    const oldestKey = store.keys().next().value;
    if (oldestKey) {
        store.delete(oldestKey);
    }
};

export const registerComponentExecutor = (
    customId: string,
    executor: SnowcordInteractionExecutor
): void => {
    setWithLimit(componentExecutors, customId, executor);
};

export const registerComponentRef = registerComponentExecutor;

export const resolveComponentExecutor = (customId: string): SnowcordInteractionExecutor | undefined =>
    componentExecutors.get(customId);

export const registerModalExecutor = (
    customId: string,
    executor: SnowcordInteractionExecutor
): void => {
    setWithLimit(modalExecutors, customId, executor);
};

export const registerModalRef = registerModalExecutor;

export const registerRef = (
    customId: string,
    executor: SnowcordInteractionExecutor
): void => {
    registerComponentExecutor(customId, executor);
    registerModalExecutor(customId, executor);
};

export const resolveModalExecutor = (customId: string): SnowcordInteractionExecutor | undefined =>
    modalExecutors.get(customId);

export const clearInteractionExecutors = (): void => {
    componentExecutors.clear();
    modalExecutors.clear();
};
