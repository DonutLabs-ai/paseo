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
  findCockpitPane,
  focusCockpitPane,
  focusCockpitWorkspace,
  getCockpitPaneWorkspaceKey,
  splitCockpitPane,
  type CockpitLayout,
  type CockpitLayoutIdSource,
} from "@/screens/cockpit/cockpit-layout";

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

const CockpitLayoutPersistedStateSchema = z.strictObject({
  layout: CockpitLayoutStorageSchema.nullable(),
  initialized: z.boolean(),
});

export interface CockpitLayoutState {
  layout: CockpitLayout | null;
  initialized: boolean;
  reconcileWorkspaces: (input: {
    workspaceKeys: readonly string[];
    preferredWorkspaceKey?: string | null;
  }) => void;
  splitPane: (paneId: string, position: "right" | "down") => void;
  addEmptyPane: () => void;
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
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

export function createCockpitLayoutStore(ids: CockpitLayoutIdSource = defaultWorkspaceLayoutIds) {
  return create<CockpitLayoutState>()(
    persist(
      (set) => ({
        layout: null,
        initialized: false,
        reconcileWorkspaces: ({ workspaceKeys, preferredWorkspaceKey }) =>
          set((state) => {
            const uniqueKeys = [...new Set(workspaceKeys.filter(Boolean))];
            if (!state.initialized) {
              return {
                initialized: true,
                layout: createDefaultCockpitLayout({
                  workspaceKeys: uniqueKeys,
                  preferredWorkspaceKey,
                  ids,
                }),
              };
            }

            const assignedKeys = new Set(
              state.layout
                ? collectCockpitPanes(state.layout.root).flatMap((pane) => {
                    const workspaceKey = getCockpitPaneWorkspaceKey(pane);
                    return workspaceKey ? [workspaceKey] : [];
                  })
                : [],
            );
            let layout = state.layout;
            for (const workspaceKey of uniqueKeys) {
              if (assignedKeys.has(workspaceKey)) continue;
              layout = addWorkspaceToCockpitLayout({ layout, workspaceKey, ids });
              assignedKeys.add(workspaceKey);
            }
            if (layout && preferredWorkspaceKey) {
              layout = focusCockpitWorkspace(layout, preferredWorkspaceKey);
            }
            return layout === state.layout ? state : { layout };
          }),
        splitPane: (paneId, position) =>
          set((state) => {
            if (!state.layout) return state;
            const layout = splitCockpitPane({
              layout: state.layout,
              targetPaneId: paneId,
              position,
              ids,
            });
            return layout ? { layout } : state;
          }),
        addEmptyPane: () =>
          set((state) => {
            if (!state.layout) {
              return { layout: createEmptyRootPane(ids), initialized: true };
            }
            const panes = collectCockpitPanes(state.layout.root);
            const targetPaneId = state.layout.focusedPaneId ?? panes[panes.length - 1]?.id ?? null;
            if (!targetPaneId) return state;
            const layout = splitCockpitPane({
              layout: state.layout,
              targetPaneId,
              position: "right",
              ids,
            });
            return layout ? { layout } : state;
          }),
        closePane: (paneId) =>
          set((state) => {
            if (!state.layout) return state;
            const result = closeCockpitPane(state.layout, paneId);
            return result ? { layout: result.layout } : state;
          }),
        focusPane: (paneId) =>
          set((state) => {
            if (!state.layout) return state;
            const layout = focusCockpitPane(state.layout, paneId);
            return layout === state.layout ? state : { layout };
          }),
      }),
      {
        name: "cockpit-layout-state",
        version: 1,
        storage: createValidatedPersistStorage(AsyncStorage, CockpitLayoutPersistedStateSchema),
        partialize: (state) => ({
          layout: state.layout,
          initialized: state.initialized,
        }),
        merge: (persistedState, currentState) => {
          const parsed = CockpitLayoutPersistedStateSchema.safeParse(persistedState);
          return parsed.success ? { ...currentState, ...parsed.data } : currentState;
        },
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
