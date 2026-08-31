import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collectCockpitPanes,
  getCockpitPaneWorkspaceKey,
  type CockpitLayoutIdSource,
} from "@/screens/cockpit/cockpit-layout";
import { createCockpitLayoutStore } from "./cockpit-layout-store";

function createIds(): CockpitLayoutIdSource {
  let nextId = 1;
  return {
    createNodeId: (prefix) => `${prefix}-${nextId++}`,
  };
}

function requireItem<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected cockpit layout item");
  return value;
}

beforeEach(async () => {
  await AsyncStorage.removeItem("cockpit-layout-state");
  vi.clearAllMocks();
});

describe("cockpit-layout-store", () => {
  it("reserves a split pane and assigns the next workspace to it", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    store.getState().reconcileWorkspaces({ workspaceKeys: ["host:a"] });
    const firstLayout = requireItem(store.getState().layout);
    const firstPane = requireItem(collectCockpitPanes(firstLayout.root)[0]);

    store.getState().splitPane(firstPane.id, "right");
    expect(
      collectCockpitPanes(requireItem(store.getState().layout).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:a", null]);

    store.getState().reconcileWorkspaces({ workspaceKeys: ["host:a", "host:b"] });
    expect(
      collectCockpitPanes(requireItem(store.getState().layout).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:a", "host:b"]);
  });

  it("restores pane topology and focus from persistent storage", async () => {
    const source = createCockpitLayoutStore(createIds());
    await source.persist.rehydrate();
    source.getState().reconcileWorkspaces({
      workspaceKeys: ["host:a", "host:b"],
      preferredWorkspaceKey: "host:b",
    });
    const sourceLayout = requireItem(source.getState().layout);
    const firstPane = requireItem(collectCockpitPanes(sourceLayout.root)[0]);
    source.getState().splitPane(firstPane.id, "down");

    await vi.waitFor(async () => {
      expect(await AsyncStorage.getItem("cockpit-layout-state")).not.toBeNull();
    });

    const restored = createCockpitLayoutStore(createIds());
    await restored.persist.rehydrate();
    const restoredLayout = restored.getState().layout;
    expect(restoredLayout).not.toBeNull();
    const persistedLayout = requireItem(restoredLayout);
    expect(collectCockpitPanes(persistedLayout.root).map(getCockpitPaneWorkspaceKey)).toEqual([
      "host:a",
      null,
      "host:b",
    ]);
    expect(persistedLayout.focusedPaneId).toBe(
      requireItem(collectCockpitPanes(persistedLayout.root)[1]).id,
    );
  });

  it("refocuses the pane that owns the last active workspace", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    store.getState().reconcileWorkspaces({
      workspaceKeys: ["host:a", "host:b"],
      preferredWorkspaceKey: "host:a",
    });
    store.getState().reconcileWorkspaces({
      workspaceKeys: ["host:a", "host:b"],
      preferredWorkspaceKey: "host:b",
    });

    const layout = requireItem(store.getState().layout);
    const focusedPane = collectCockpitPanes(layout.root).find(
      (pane) => pane.id === layout.focusedPaneId,
    );
    expect(focusedPane && getCockpitPaneWorkspaceKey(focusedPane)).toBe("host:b");
  });

  it("focuses a workspace explicitly from the attention center", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    store.getState().reconcileWorkspaces({
      workspaceKeys: ["host:a", "host:b"],
      preferredWorkspaceKey: "host:a",
    });

    store.getState().focusWorkspace("host:b");

    const layout = requireItem(store.getState().layout);
    const focusedPane = collectCockpitPanes(layout.root).find(
      (pane) => pane.id === layout.focusedPaneId,
    );
    expect(focusedPane && getCockpitPaneWorkspaceKey(focusedPane)).toBe("host:b");
  });

  it("persists a manual card move without reconciling it back to the original layout", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    const workspaceKeys = ["host:a", "host:b", "host:c", "host:d", "host:e", "host:f"];
    store.getState().reconcileWorkspaces({ workspaceKeys });
    const initial = requireItem(store.getState().layout);
    const panes = collectCockpitPanes(initial.root);
    const targetPane = requireItem(
      panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "host:b"),
    );
    const movedPane = requireItem(
      panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "host:e"),
    );

    store.getState().movePane({
      paneId: movedPane.id,
      targetPaneId: targetPane.id,
      direction: "up",
    });
    await vi.waitFor(async () => {
      expect(await AsyncStorage.getItem("cockpit-layout-state")).not.toBeNull();
    });

    const restoredStore = createCockpitLayoutStore(createIds());
    await restoredStore.persist.rehydrate();
    restoredStore.getState().reconcileWorkspaces({ workspaceKeys });

    const moved = requireItem(restoredStore.getState().layout);
    expect(moved.root.kind).toBe("group");
    if (moved.root.kind !== "group") throw new Error("Expected vertical root group");
    expect(
      moved.root.group.children.map((row) =>
        collectCockpitPanes(row).map(getCockpitPaneWorkspaceKey),
      ),
    ).toEqual([
      ["host:a", "host:b", "host:e", "host:c"],
      ["host:d", "host:f"],
    ]);
  });

  it("persists a bottom-edge move as a new row", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    const workspaceKeys = ["host:a", "host:b", "host:c", "host:d", "host:e", "host:f"];
    store.getState().reconcileWorkspaces({ workspaceKeys });
    const initial = requireItem(store.getState().layout);
    const movedPane = requireItem(
      collectCockpitPanes(initial.root).find(
        (pane) => getCockpitPaneWorkspaceKey(pane) === "host:e",
      ),
    );

    store.getState().movePane({
      paneId: movedPane.id,
      targetPaneId: null,
      direction: "down",
    });
    await vi.waitFor(async () => {
      expect(await AsyncStorage.getItem("cockpit-layout-state")).not.toBeNull();
    });

    const restoredStore = createCockpitLayoutStore(createIds());
    await restoredStore.persist.rehydrate();
    restoredStore.getState().reconcileWorkspaces({ workspaceKeys });

    const moved = requireItem(restoredStore.getState().layout);
    expect(moved.root.kind).toBe("group");
    if (moved.root.kind !== "group") throw new Error("Expected vertical root group");
    expect(moved.root.group.direction).toBe("vertical");
    expect(
      moved.root.group.children.map((row) =>
        collectCockpitPanes(row).map(getCockpitPaneWorkspaceKey),
      ),
    ).toEqual([["host:a", "host:b", "host:c"], ["host:d", "host:f"], ["host:e"]]);
  });
});
