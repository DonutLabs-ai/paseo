import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { defaultWorkspaceLayoutIds } from "@/stores/workspace-layout-ids";
import {
  addWorkspaceToCockpitLayout,
  closeCockpitPane,
  collectCockpitPanes,
  createDefaultCockpitLayout,
  filterCockpitLayout,
  findCockpitPane,
  focusCockpitPane,
  focusCockpitWorkspace,
  getCockpitPaneWorkspaceKey,
  moveCockpitPane,
  splitCockpitPane,
  type CockpitLayout,
  type CockpitLayoutIdSource,
  type CockpitPaneMoveDirection,
} from "@/screens/cockpit/cockpit-layout";

const COCKPIT_LAYOUT_PERSIST_VERSION = 2;

const CockpitSplitNodeStorageSchema: z.ZodType<CockpitLayout["root"]> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("pane"),
      pane: z
        .strictObject({
          id: z.string().min(1),
          tabIds: z.array(z.string().min(1)).max(1),
          focusedTabId: z.string().min(1).nullable(),
          hidden: z.boolean().optional(),
        })
        .refine((pane) => pane.focusedTabId === (pane.tabIds[0] ?? null)),
    }),
    z.strictObject({
      kind: z.literal("group"),
      group: z
        .strictObject({
          id: z.string().min(1),
          direction: z.enum(["horizontal", "vertical"]),
          children: z.array(CockpitSplitNodeStorageSchema).min(2),
          sizes: z.array(z.number().positive()).min(2),
        })
        .refine((group) => group.children.length === group.sizes.length)
        .refine((group) => {
          const expectedSize = 1 / group.children.length;
          return group.sizes.every((size) => Math.abs(size - expectedSize) < 0.000001);
        }),
    }),
  ]),
);

const CockpitLayoutStorageSchema: z.ZodType<CockpitLayout> = z
  .strictObject({
    root: CockpitSplitNodeStorageSchema,
    focusedPaneId: z.string().min(1).nullable(),
  })
  .refine(
    (layout) =>
      layout.focusedPaneId === null || findCockpitPane(layout.root, layout.focusedPaneId) !== null,
  );

const CockpitProjectLayoutPersistedStateSchema = z.strictObject({
  layout: CockpitLayoutStorageSchema.nullable(),
  initialized: z.boolean(),
});

const LegacyCockpitLayoutPersistedStateSchema = CockpitProjectLayoutPersistedStateSchema;

const ProjectScopedCockpitLayoutPersistedStateSchema = z.strictObject({
  layoutsByProject: z.record(z.string().min(1), CockpitProjectLayoutPersistedStateSchema),
  legacyGlobalLayout: CockpitProjectLayoutPersistedStateSchema.nullable(),
});

const CockpitLayoutPersistedStateSchema = z.union([
  ProjectScopedCockpitLayoutPersistedStateSchema,
  LegacyCockpitLayoutPersistedStateSchema,
]);

export interface CockpitProjectLayoutState {
  layout: CockpitLayout | null;
  initialized: boolean;
}

export interface CockpitProjectRegistration {
  projectViewKey: string;
  workspaceKeys: readonly string[];
}

export interface CockpitLayoutState {
  layoutsByProject: Record<string, CockpitProjectLayoutState>;
  legacyGlobalLayout: CockpitProjectLayoutState | null;
  reconcileProjects: (input: {
    projects: readonly CockpitProjectRegistration[];
    preferredWorkspaceKey?: string | null;
  }) => void;
  splitPane: (projectViewKey: string, paneId: string, position: "right" | "down") => void;
  movePane: (input: {
    projectViewKey: string;
    paneId: string;
    targetPaneId: string | null;
    direction: CockpitPaneMoveDirection;
  }) => void;
  addEmptyPane: (projectViewKey: string) => void;
  closePane: (projectViewKey: string, paneId: string) => void;
  focusPane: (projectViewKey: string, paneId: string) => void;
  focusWorkspace: (projectViewKey: string, workspaceKey: string) => void;
}

function createEmptyRootPane(ids: CockpitLayoutIdSource): CockpitLayout {
  const root = {
    kind: "pane" as const,
    pane: {
      id: ids.createNodeId("pane"),
      tabIds: [],
      focusedTabId: null,
    },
  };
  return { root, focusedPaneId: root.pane.id };
}

function normalizeProjectRegistrations(
  projects: readonly CockpitProjectRegistration[],
): CockpitProjectRegistration[] {
  const workspaceKeysByProject = new Map<string, string[]>();
  const seenWorkspaceKeysByProject = new Map<string, Set<string>>();
  for (const project of projects) {
    const projectViewKey = project.projectViewKey.trim();
    if (!projectViewKey) continue;
    let workspaceKeys = workspaceKeysByProject.get(projectViewKey);
    let seenWorkspaceKeys = seenWorkspaceKeysByProject.get(projectViewKey);
    if (!workspaceKeys || !seenWorkspaceKeys) {
      workspaceKeys = [];
      seenWorkspaceKeys = new Set<string>();
      workspaceKeysByProject.set(projectViewKey, workspaceKeys);
      seenWorkspaceKeysByProject.set(projectViewKey, seenWorkspaceKeys);
    }
    for (const workspaceKey of project.workspaceKeys) {
      if (!workspaceKey || seenWorkspaceKeys.has(workspaceKey)) continue;
      seenWorkspaceKeys.add(workspaceKey);
      workspaceKeys.push(workspaceKey);
    }
  }
  return [...workspaceKeysByProject].map(([projectViewKey, workspaceKeys]) => ({
    projectViewKey,
    workspaceKeys,
  }));
}

function migrateLegacyProjectLayout(input: {
  legacyGlobalLayout: CockpitProjectLayoutState | null;
  workspaceKeys: readonly string[];
}): CockpitProjectLayoutState {
  if (!input.legacyGlobalLayout?.initialized || !input.legacyGlobalLayout.layout) {
    return { layout: null, initialized: false };
  }
  const layout = filterCockpitLayout(
    input.legacyGlobalLayout.layout,
    new Set(input.workspaceKeys),
    { retainEmptyPanes: false },
  );
  return layout ? { layout, initialized: true } : { layout: null, initialized: false };
}

function reconcileProjectLayout(input: {
  current: CockpitProjectLayoutState;
  workspaceKeys: readonly string[];
  preferredWorkspaceKey: string | null;
  ids: CockpitLayoutIdSource;
}): CockpitProjectLayoutState {
  if (!input.current.initialized) {
    return {
      initialized: true,
      layout: createDefaultCockpitLayout({
        workspaceKeys: input.workspaceKeys,
        preferredWorkspaceKey: input.preferredWorkspaceKey,
        ids: input.ids,
      }),
    };
  }

  const assignedKeys = new Set(
    input.current.layout
      ? collectCockpitPanes(input.current.layout.root).flatMap((pane) => {
          const workspaceKey = getCockpitPaneWorkspaceKey(pane);
          return workspaceKey ? [workspaceKey] : [];
        })
      : [],
  );
  let layout = input.current.layout;
  for (const workspaceKey of input.workspaceKeys) {
    if (assignedKeys.has(workspaceKey)) continue;
    layout = addWorkspaceToCockpitLayout({
      layout,
      workspaceKey,
      ids: input.ids,
    });
    assignedKeys.add(workspaceKey);
  }
  if (layout && input.preferredWorkspaceKey) {
    layout = focusCockpitWorkspace(layout, input.preferredWorkspaceKey);
  }
  return layout === input.current.layout ? input.current : { ...input.current, layout };
}

function updateProjectLayout(input: {
  state: CockpitLayoutState;
  projectViewKey: string;
  update: (current: CockpitProjectLayoutState) => CockpitProjectLayoutState;
}): CockpitLayoutState | Partial<CockpitLayoutState> {
  const current = input.state.layoutsByProject[input.projectViewKey];
  if (!current) return input.state;
  const next = input.update(current);
  if (next === current) return input.state;
  return {
    layoutsByProject: {
      ...input.state.layoutsByProject,
      [input.projectViewKey]: next,
    },
  };
}

function normalizePersistedState(persistedState: unknown): {
  layoutsByProject: Record<string, CockpitProjectLayoutState>;
  legacyGlobalLayout: CockpitProjectLayoutState | null;
} {
  const parsed = CockpitLayoutPersistedStateSchema.safeParse(persistedState);
  if (!parsed.success) {
    return { layoutsByProject: {}, legacyGlobalLayout: null };
  }
  if ("layoutsByProject" in parsed.data) {
    return parsed.data;
  }
  return {
    layoutsByProject: {},
    legacyGlobalLayout: parsed.data,
  };
}

export function createCockpitLayoutStore(ids: CockpitLayoutIdSource = defaultWorkspaceLayoutIds) {
  return create<CockpitLayoutState>()(
    persist(
      (set) => ({
        layoutsByProject: {},
        legacyGlobalLayout: null,
        reconcileProjects: ({ projects, preferredWorkspaceKey }) =>
          set((state) => {
            const normalizedProjects = normalizeProjectRegistrations(projects);
            if (normalizedProjects.length === 0) return state;
            let changed = state.legacyGlobalLayout !== null;
            const layoutsByProject = { ...state.layoutsByProject };
            for (const project of normalizedProjects) {
              const current =
                layoutsByProject[project.projectViewKey] ??
                migrateLegacyProjectLayout({
                  legacyGlobalLayout: state.legacyGlobalLayout,
                  workspaceKeys: project.workspaceKeys,
                });
              const projectPreferredWorkspaceKey =
                preferredWorkspaceKey && project.workspaceKeys.includes(preferredWorkspaceKey)
                  ? preferredWorkspaceKey
                  : null;
              const next = reconcileProjectLayout({
                current,
                workspaceKeys: project.workspaceKeys,
                preferredWorkspaceKey: projectPreferredWorkspaceKey,
                ids,
              });
              if (layoutsByProject[project.projectViewKey] !== next) {
                layoutsByProject[project.projectViewKey] = next;
                changed = true;
              }
            }
            if (!changed) return state;
            return { layoutsByProject, legacyGlobalLayout: null };
          }),
        splitPane: (projectViewKey, paneId, position) =>
          set((state) =>
            updateProjectLayout({
              state,
              projectViewKey,
              update: (current) => {
                if (!current.layout) return current;
                const layout = splitCockpitPane({
                  layout: current.layout,
                  targetPaneId: paneId,
                  position,
                  ids,
                });
                return layout ? { ...current, layout } : current;
              },
            }),
          ),
        movePane: ({ projectViewKey, paneId, targetPaneId, direction }) =>
          set((state) =>
            updateProjectLayout({
              state,
              projectViewKey,
              update: (current) => {
                if (!current.layout) return current;
                const layout = moveCockpitPane({
                  layout: current.layout,
                  paneId,
                  targetPaneId,
                  direction,
                  ids,
                });
                return layout ? { ...current, layout } : current;
              },
            }),
          ),
        addEmptyPane: (projectViewKey) =>
          set((state) => {
            const current = state.layoutsByProject[projectViewKey];
            if (!current) {
              return {
                layoutsByProject: {
                  ...state.layoutsByProject,
                  [projectViewKey]: { layout: createEmptyRootPane(ids), initialized: true },
                },
              };
            }
            return updateProjectLayout({
              state,
              projectViewKey,
              update: (projectState) => {
                if (!projectState.layout) {
                  return { layout: createEmptyRootPane(ids), initialized: true };
                }
                const panes = collectCockpitPanes(projectState.layout.root);
                const targetPaneId =
                  projectState.layout.focusedPaneId ?? panes[panes.length - 1]?.id ?? null;
                if (!targetPaneId) return projectState;
                const layout = splitCockpitPane({
                  layout: projectState.layout,
                  targetPaneId,
                  position: "right",
                  ids,
                });
                return layout ? { ...projectState, layout } : projectState;
              },
            });
          }),
        closePane: (projectViewKey, paneId) =>
          set((state) =>
            updateProjectLayout({
              state,
              projectViewKey,
              update: (current) => {
                if (!current.layout) return current;
                const result = closeCockpitPane(current.layout, paneId);
                return result ? { ...current, layout: result.layout } : current;
              },
            }),
          ),
        focusPane: (projectViewKey, paneId) =>
          set((state) =>
            updateProjectLayout({
              state,
              projectViewKey,
              update: (current) => {
                if (!current.layout) return current;
                const layout = focusCockpitPane(current.layout, paneId);
                return layout === current.layout ? current : { ...current, layout };
              },
            }),
          ),
        focusWorkspace: (projectViewKey, workspaceKey) =>
          set((state) =>
            updateProjectLayout({
              state,
              projectViewKey,
              update: (current) => {
                if (!current.layout) return current;
                const layout = focusCockpitWorkspace(current.layout, workspaceKey);
                return layout === current.layout ? current : { ...current, layout };
              },
            }),
          ),
      }),
      {
        name: "cockpit-layout-state",
        version: COCKPIT_LAYOUT_PERSIST_VERSION,
        storage: createValidatedPersistStorage(AsyncStorage, CockpitLayoutPersistedStateSchema),
        partialize: (state) => ({
          layoutsByProject: state.layoutsByProject,
          legacyGlobalLayout: state.legacyGlobalLayout,
        }),
        migrate: (persistedState) => normalizePersistedState(persistedState),
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...normalizePersistedState(persistedState),
        }),
      },
    ),
  );
}

export const useCockpitLayoutStore = createCockpitLayoutStore();

export function useCockpitLayoutStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useCockpitLayoutStore.persist.hasHydrated());
  useEffect(() => {
    if (useCockpitLayoutStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useCockpitLayoutStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}
