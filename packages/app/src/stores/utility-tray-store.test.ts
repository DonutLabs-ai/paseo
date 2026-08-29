import { beforeEach, describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createUtilityTrayStore } from "./utility-tray-store";

function createMemoryStorage(): StateStorage {
  const values = new Map<string, string>();
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  };
}

describe("utility tray store", () => {
  let storage: StateStorage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("persists the utility terminal identity without persisting visibility", async () => {
    const first = createUtilityTrayStore(storage);
    first.getState().selectTarget({
      serverId: "server-1",
      utilityTerminalId: "utility-1",
    });

    const second = createUtilityTrayStore(storage);
    await second.persist.rehydrate();
    expect(second.getState().target).toEqual({
      serverId: "server-1",
      utilityTerminalId: "utility-1",
    });
    expect(second.getState().isOpen).toBe(false);
  });

  it("rejects malformed persisted targets", async () => {
    await storage.setItem(
      "utility-tray-state",
      JSON.stringify({
        state: { target: { serverId: "server-1", workspaceId: "workspace-1" } },
        version: 1,
      }),
    );

    const store = createUtilityTrayStore(storage);
    await store.persist.rehydrate();
    expect(store.getState().target).toBeNull();
  });
});
