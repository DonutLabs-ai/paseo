import { beforeEach, describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createCockpitSnoozeStore,
  shouldSuppressSnoozedAttentionNotification,
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
});
