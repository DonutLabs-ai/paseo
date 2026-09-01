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
  createDefaultCockpitLayout,
  getCockpitPaneWorkspaceKey,
  splitCockpitPane,
  type CockpitLayoutIdSource,
} from "@/screens/cockpit/cockpit-layout";
import { createCockpitLayoutStore } from "./cockpit-layout-store";

const PROJECT = "project:backend";

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

function getProjectLayout(
  store: ReturnType<typeof createCockpitLayoutStore>,
  projectViewKey = PROJECT,
) {
  return store.getState().layoutsByProject[projectViewKey]?.layout ?? null;
}

function reconcileProject(
  store: ReturnType<typeof createCockpitLayoutStore>,
  workspaceKeys: readonly string[],
  preferredWorkspaceKey?: string,
): void {
  store.getState().reconcileProjects({
    projects: [{ projectViewKey: PROJECT, workspaceKeys }],
    preferredWorkspaceKey,
  });
}

beforeEach(async () => {
  await AsyncStorage.removeItem("cockpit-layout-state");
  vi.clearAllMocks();
});

describe("cockpit-layout-store", () => {
  it("reserves a split pane and assigns the next workspace to it", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    reconcileProject(store, ["host:a"]);
    const firstLayout = requireItem(getProjectLayout(store));
    const firstPane = requireItem(collectCockpitPanes(firstLayout.root)[0]);

    store.getState().splitPane(PROJECT, firstPane.id, "right");
    expect(
      collectCockpitPanes(requireItem(getProjectLayout(store)).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:a", null]);

    reconcileProject(store, ["host:a", "host:b"]);
    expect(
      collectCockpitPanes(requireItem(getProjectLayout(store)).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:a", "host:b"]);
  });

  it("restores pane topology and focus from persistent storage", async () => {
    const source = createCockpitLayoutStore(createIds());
    await source.persist.rehydrate();
    reconcileProject(source, ["host:a", "host:b"], "host:b");
    const sourceLayout = requireItem(getProjectLayout(source));
    const firstPane = requireItem(collectCockpitPanes(sourceLayout.root)[0]);
    source.getState().splitPane(PROJECT, firstPane.id, "down");

    await vi.waitFor(async () => {
      expect(await AsyncStorage.getItem("cockpit-layout-state")).not.toBeNull();
    });

    const restored = createCockpitLayoutStore(createIds());
    await restored.persist.rehydrate();
    const restoredLayout = getProjectLayout(restored);
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

  it("persists independent layouts for each project", async () => {
    const source = createCockpitLayoutStore(createIds());
    await source.persist.rehydrate();
    source.getState().reconcileProjects({
      projects: [
        { projectViewKey: "project:backend", workspaceKeys: ["host:backend-a"] },
        { projectViewKey: "project:automations", workspaceKeys: ["host:automation-a"] },
      ],
      preferredWorkspaceKey: "host:backend-a",
    });
    const backendLayout = requireItem(getProjectLayout(source, "project:backend"));
    const backendPane = requireItem(collectCockpitPanes(backendLayout.root)[0]);
    source.getState().splitPane("project:backend", backendPane.id, "right");

    expect(
      collectCockpitPanes(requireItem(getProjectLayout(source, "project:automations")).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:automation-a"]);

    await vi.waitFor(async () => {
      expect(await AsyncStorage.getItem("cockpit-layout-state")).not.toBeNull();
    });
    const restored = createCockpitLayoutStore(createIds());
    await restored.persist.rehydrate();

    expect(
      collectCockpitPanes(requireItem(getProjectLayout(restored, "project:backend")).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:backend-a", null]);
    expect(
      collectCockpitPanes(requireItem(getProjectLayout(restored, "project:automations")).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:automation-a"]);
  });

  it("partitions the legacy global layout by project without duplicating empty panes", async () => {
    const ids = createIds();
    const baseLayout = requireItem(
      createDefaultCockpitLayout({
        workspaceKeys: ["host:backend-a", "host:automation-a"],
        ids,
      }),
    );
    const backendPane = requireItem(collectCockpitPanes(baseLayout.root)[0]);
    const legacyLayout = requireItem(
      splitCockpitPane({
        layout: baseLayout,
        targetPaneId: backendPane.id,
        position: "down",
        ids,
      }),
    );
    await AsyncStorage.setItem(
      "cockpit-layout-state",
      JSON.stringify({
        state: { layout: legacyLayout, initialized: true },
        version: 1,
      }),
    );

    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    store.getState().reconcileProjects({
      projects: [
        { projectViewKey: "project:backend", workspaceKeys: ["host:backend-a"] },
        { projectViewKey: "project:automations", workspaceKeys: ["host:automation-a"] },
      ],
      preferredWorkspaceKey: "host:backend-a",
    });

    expect(
      collectCockpitPanes(requireItem(getProjectLayout(store, "project:backend")).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:backend-a"]);
    expect(
      collectCockpitPanes(requireItem(getProjectLayout(store, "project:automations")).root).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["host:automation-a"]);
    expect(store.getState().legacyGlobalLayout).toBeNull();
  });

  it("refocuses the pane that owns the last active workspace", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    reconcileProject(store, ["host:a", "host:b"], "host:a");
    reconcileProject(store, ["host:a", "host:b"], "host:b");

    const layout = requireItem(getProjectLayout(store));
    const focusedPane = collectCockpitPanes(layout.root).find(
      (pane) => pane.id === layout.focusedPaneId,
    );
    expect(focusedPane && getCockpitPaneWorkspaceKey(focusedPane)).toBe("host:b");
  });

  it("focuses a workspace explicitly from the attention center", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    reconcileProject(store, ["host:a", "host:b"], "host:a");

    store.getState().focusWorkspace(PROJECT, "host:b");

    const layout = requireItem(getProjectLayout(store));
    const focusedPane = collectCockpitPanes(layout.root).find(
      (pane) => pane.id === layout.focusedPaneId,
    );
    expect(focusedPane && getCockpitPaneWorkspaceKey(focusedPane)).toBe("host:b");
  });

  it("persists a manual card move without reconciling it back to the original layout", async () => {
    const store = createCockpitLayoutStore(createIds());
    await store.persist.rehydrate();
    const workspaceKeys = ["host:a", "host:b", "host:c", "host:d", "host:e", "host:f"];
    reconcileProject(store, workspaceKeys);
    const initial = requireItem(getProjectLayout(store));
    const panes = collectCockpitPanes(initial.root);
    const targetPane = requireItem(
      panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "host:b"),
    );
    const movedPane = requireItem(
      panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "host:e"),
    );

    store.getState().movePane({
      projectViewKey: PROJECT,
      paneId: movedPane.id,
      targetPaneId: targetPane.id,
      direction: "up",
    });
    await vi.waitFor(async () => {
      expect(await AsyncStorage.getItem("cockpit-layout-state")).not.toBeNull();
    });

    const restoredStore = createCockpitLayoutStore(createIds());
    await restoredStore.persist.rehydrate();
    reconcileProject(restoredStore, workspaceKeys);

    const moved = requireItem(getProjectLayout(restoredStore));
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
    reconcileProject(store, workspaceKeys);
    const initial = requireItem(getProjectLayout(store));
    const movedPane = requireItem(
      collectCockpitPanes(initial.root).find(
        (pane) => getCockpitPaneWorkspaceKey(pane) === "host:e",
      ),
    );

    store.getState().movePane({
      projectViewKey: PROJECT,
      paneId: movedPane.id,
      targetPaneId: null,
      direction: "down",
    });
    await vi.waitFor(async () => {
      expect(await AsyncStorage.getItem("cockpit-layout-state")).not.toBeNull();
    });

    const restoredStore = createCockpitLayoutStore(createIds());
    await restoredStore.persist.rehydrate();
    reconcileProject(restoredStore, workspaceKeys);

    const moved = requireItem(getProjectLayout(restoredStore));
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
