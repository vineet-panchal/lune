import { useSyncExternalStore } from "react";

/**
 * A minimal value store. Lets frequently-updated data (e.g. satellite counts every few seconds)
 * re-render only the components that read it, instead of the whole globe page.
 */
export type Store<T> = {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
};

/** What a component that only reads the store needs. */
export type ReadableStore<T> = Pick<Store<T>, "get" | "subscribe">;

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
