import { beforeEach, describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createCockpitSnoozeStore,
  shouldSuppressSnoozedAttentionNotification,
  shouldWakeForScheduleRun,
  shouldWakeSnoozedWorkspace,
} from "./cockpit-snooze-store";

function createMemoryStorage(): StateStorage {
  const values = new Map<string, string>();
  return {
    getItem: async (name) => values.get(name) ?? null,
    setItem: async (name, value) => {
      values.set(name, value);
    },
    removeItem: async (name) => {
      values.delete(name);
    },
  };
}

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return {
    promise,
    resolve: (value: T | PromiseLike<T>) => resolve?.(value),
  };
}

describe("cockpit snooze store", () => {
  let storage: StateStorage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("persists snoozed workspaces", async () => {
    const first = createCockpitSnoozeStore(storage);
    await first.persist.rehydrate();
    first.getState().setSnoozed("host:workspace", true);

    const restored = createCockpitSnoozeStore(storage);
    await restored.persist.rehydrate();

    expect(restored.getState().snoozedAtByWorkspace["host:workspace"]).toBeTypeOf("string");
  });

  it("wakes for permission and error attention but remains snoozed after an ordinary finish", async () => {
    const store = createCockpitSnoozeStore(storage);
    await store.persist.rehydrate();
    store.getState().setSnoozed("host:workspace", true);

    store.getState().wakeForAttention("host:workspace", "finished");
    expect(store.getState().snoozedAtByWorkspace["host:workspace"]).toBeTypeOf("string");

    store.getState().wakeForAttention("host:workspace", "permission");
    expect(store.getState().snoozedAtByWorkspace["host:workspace"]).toBeUndefined();

    store.getState().setSnoozed("host:workspace", true);
    store.getState().wakeForAttention("host:workspace", "error");
    expect(store.getState().snoozedAtByWorkspace["host:workspace"]).toBeUndefined();
  });

  it("defines the same wake policy used by notification handling", () => {
    expect(shouldWakeSnoozedWorkspace("finished")).toBe(false);
    expect(shouldWakeSnoozedWorkspace("permission")).toBe(true);
    expect(shouldWakeSnoozedWorkspace("error")).toBe(true);
    expect(shouldSuppressSnoozedAttentionNotification("finished", true)).toBe(true);
    expect(shouldSuppressSnoozedAttentionNotification("finished", false)).toBe(false);
    expect(shouldSuppressSnoozedAttentionNotification("permission", true)).toBe(false);
    expect(shouldSuppressSnoozedAttentionNotification("error", true)).toBe(false);
  });

  it("wakes only when a schedule run started after the workspace was snoozed", async () => {
    const store = createCockpitSnoozeStore(storage);
    await store.persist.rehydrate();
    store.setState({
      snoozedAtByWorkspace: { "host:workspace": "2026-09-03T09:00:00.000Z" },
    });

    store.getState().wakeForScheduleRun("host:workspace", "2026-09-03T08:59:59.000Z");
    expect(store.getState().snoozedAtByWorkspace["host:workspace"]).toBeTypeOf("string");

    store.getState().wakeForScheduleRun("host:workspace", "2026-09-03T09:00:01.000Z");
    expect(store.getState().snoozedAtByWorkspace["host:workspace"]).toBeUndefined();
    expect(shouldWakeForScheduleRun(undefined, "2026-09-03T09:00:01.000Z")).toBe(false);
    expect(shouldWakeForScheduleRun("invalid", "2026-09-03T09:00:01.000Z")).toBe(false);
  });

  it("does not restore stale snooze state when the agent directory loaded first", async () => {
    const persisted = createCockpitSnoozeStore(storage);
    await persisted.persist.rehydrate();
    persisted.setState({
      snoozedAtByWorkspace: { "host:workspace": "2026-09-03T09:00:00.000Z" },
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const delayedRead = createDeferred<string | null>();
    const delayedStorage: StateStorage = {
      ...storage,
      getItem: async () => delayedRead.promise,
    };
    const restored = createCockpitSnoozeStore(delayedStorage);
    restored.getState().wakeForScheduleRun("host:workspace", "2026-09-03T09:00:01.000Z");
    delayedRead.resolve(await storage.getItem("cockpit-snooze-state"));
    await restored.persist.rehydrate();

    expect(restored.getState().snoozedAtByWorkspace["host:workspace"]).toBeUndefined();
  });
});
