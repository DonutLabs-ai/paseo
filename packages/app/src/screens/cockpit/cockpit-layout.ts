import type { SplitNode, SplitPane, WorkspaceLayout } from "@/stores/workspace-layout-store";

export const COCKPIT_CARD_GAP = 1;
export const COCKPIT_CARD_MIN_HEIGHT = 210;
export const COCKPIT_DEFAULT_COLUMNS = 3;
export const COCKPIT_HORIZONTAL_PADDING = 8;

export type CockpitLayout = WorkspaceLayout;
export type CockpitPaneMoveDirection = "left" | "right" | "up" | "down";

export interface CockpitLayoutIdSource {
  createNodeId: (prefix: "pane" | "group") => string;
}

function equalSizes(count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, () => 1 / count);
}

function createPaneNode(workspaceKey: string | null, ids: CockpitLayoutIdSource): SplitNode {
  return {
    kind: "pane",
    pane: {
      id: ids.createNodeId("pane"),
      tabIds: workspaceKey ? [workspaceKey] : [],
      focusedTabId: workspaceKey,
    },
  };
}

function createGroupNode(
  direction: "horizontal" | "vertical",
  children: SplitNode[],
  ids: CockpitLayoutIdSource,
): SplitNode {
  if (children.length === 1) {
    const child = children[0];
    if (!child) throw new Error("Single-child cockpit group is missing its child");
    return child;
  }
  return {
    kind: "group",
    group: {
      id: ids.createNodeId("group"),
      direction,
      children,
      sizes: equalSizes(children.length),
    },
  };
}

function distributeRows(itemCount: number, maxColumns: number): number[] {
  if (itemCount <= 0) return [];
  const rowCount = Math.ceil(itemCount / maxColumns);
  const baseSize = Math.floor(itemCount / rowCount);
  const largerRows = itemCount % rowCount;
  return Array.from({ length: rowCount }, (_, index) =>
    index < largerRows ? baseSize + 1 : baseSize,
  );
}

export function createDefaultCockpitLayout(input: {
  workspaceKeys: readonly string[];
  ids: CockpitLayoutIdSource;
  preferredWorkspaceKey?: string | null;
  maxColumns?: number;
}): CockpitLayout | null {
  const uniqueWorkspaceKeys = [...new Set(input.workspaceKeys.filter(Boolean))];
  if (uniqueWorkspaceKeys.length === 0) return null;

  const rowSizes = distributeRows(
    uniqueWorkspaceKeys.length,
    Math.max(1, input.maxColumns ?? COCKPIT_DEFAULT_COLUMNS),
  );
  let offset = 0;
  const rows = rowSizes.map((rowSize) => {
    const keys = uniqueWorkspaceKeys.slice(offset, offset + rowSize);
    offset += rowSize;
    return createGroupNode(
      "horizontal",
      keys.map((workspaceKey) => createPaneNode(workspaceKey, input.ids)),
      input.ids,
    );
  });
  const root = createGroupNode("vertical", rows, input.ids);
  const preferredPane = input.preferredWorkspaceKey
    ? collectCockpitPanes(root).find(
        (pane) => getCockpitPaneWorkspaceKey(pane) === input.preferredWorkspaceKey,
      )
    : null;
  return {
    root,
    focusedPaneId: preferredPane?.id ?? collectCockpitPanes(root)[0]?.id ?? null,
  };
}

export function getCockpitPaneWorkspaceKey(pane: SplitPane): string | null {
  return pane.tabIds[0] ?? null;
}

export function collectCockpitPanes(node: SplitNode): SplitPane[] {
  if (node.kind === "pane") return [node.pane];
  return node.group.children.flatMap(collectCockpitPanes);
}

export function findCockpitPane(node: SplitNode, paneId: string): SplitPane | null {
  if (node.kind === "pane") return node.pane.id === paneId ? node.pane : null;
  for (const child of node.group.children) {
    const pane = findCockpitPane(child, paneId);
    if (pane) return pane;
  }
  return null;
}

function updatePane(
  node: SplitNode,
  paneId: string,
  update: (pane: SplitPane) => SplitPane,
): SplitNode {
  if (node.kind === "pane") {
    return node.pane.id === paneId ? { kind: "pane", pane: update(node.pane) } : node;
  }
  return {
    kind: "group",
    group: {
      ...node.group,
      children: node.group.children.map((child) => updatePane(child, paneId, update)),
    },
  };
}

function splitNode(input: {
  node: SplitNode;
  targetPaneId: string;
  direction: "horizontal" | "vertical";
  workspaceKey: string | null;
  ids: CockpitLayoutIdSource;
}): { node: SplitNode; paneId: string } | null {
  if (input.node.kind === "pane") {
    if (input.node.pane.id !== input.targetPaneId) return null;
    const newPane = createPaneNode(input.workspaceKey, input.ids);
    if (newPane.kind !== "pane") throw new Error("New cockpit pane must be a pane node");
    return {
      paneId: newPane.pane.id,
      node: createGroupNode(input.direction, [input.node, newPane], input.ids),
    };
  }

  const targetIndex = input.node.group.children.findIndex(
    (child) => findCockpitPane(child, input.targetPaneId) !== null,
  );
  if (targetIndex < 0) return null;

  const targetChild = input.node.group.children[targetIndex];
  if (!targetChild) throw new Error("Cockpit split target index has no child");
  if (
    input.node.group.direction === input.direction &&
    targetChild.kind === "pane" &&
    targetChild.pane.id === input.targetPaneId
  ) {
    const newPane = createPaneNode(input.workspaceKey, input.ids);
    if (newPane.kind !== "pane") throw new Error("New cockpit pane must be a pane node");
    const children = input.node.group.children.slice();
    children.splice(targetIndex + 1, 0, newPane);
    return {
      paneId: newPane.pane.id,
      node: {
        kind: "group",
        group: {
          ...input.node.group,
          children,
          sizes: equalSizes(children.length),
        },
      },
    };
  }

  const childResult = splitNode({
    ...input,
    node: targetChild,
  });
  if (!childResult) return null;
  const children = input.node.group.children.slice();
  children[targetIndex] = childResult.node;
  return {
    paneId: childResult.paneId,
    node: {
      kind: "group",
      group: {
        ...input.node.group,
        children,
        sizes: equalSizes(children.length),
      },
    },
  };
}

function splitCockpitPaneWithWorkspace(input: {
  layout: CockpitLayout;
  targetPaneId: string;
  position: "right" | "down";
  workspaceKey: string | null;
  ids: CockpitLayoutIdSource;
}): CockpitLayout | null {
  const result = splitNode({
    node: input.layout.root,
    targetPaneId: input.targetPaneId,
    direction: input.position === "right" ? "horizontal" : "vertical",
    workspaceKey: input.workspaceKey,
    ids: input.ids,
  });
  if (!result) return null;
  return { root: result.node, focusedPaneId: result.paneId };
}

export function splitCockpitPane(input: {
  layout: CockpitLayout;
  targetPaneId: string;
  position: "right" | "down";
  ids: CockpitLayoutIdSource;
}): CockpitLayout | null {
  return splitCockpitPaneWithWorkspace({ ...input, workspaceKey: null });
}

export function addWorkspaceToCockpitLayout(input: {
  layout: CockpitLayout | null;
  workspaceKey: string;
  ids: CockpitLayoutIdSource;
}): CockpitLayout {
  if (!input.layout) {
    const root = createPaneNode(input.workspaceKey, input.ids);
    if (root.kind !== "pane") throw new Error("New cockpit root must be a pane node");
    return { root, focusedPaneId: root.pane.id };
  }
  const currentLayout = input.layout;

  const emptyPanes = collectCockpitPanes(currentLayout.root).filter(
    (pane) => getCockpitPaneWorkspaceKey(pane) === null,
  );
  const emptyPane =
    emptyPanes.find((pane) => pane.id === currentLayout.focusedPaneId) ?? emptyPanes[0];
  if (emptyPane) {
    return {
      root: updatePane(currentLayout.root, emptyPane.id, (pane) => ({
        ...pane,
        tabIds: [input.workspaceKey],
        focusedTabId: input.workspaceKey,
      })),
      focusedPaneId: currentLayout.focusedPaneId,
    };
  }

  const panes = collectCockpitPanes(currentLayout.root);
  const targetPaneId = panes[panes.length - 1]?.id ?? null;
  if (!targetPaneId) {
    throw new Error("Cockpit layout root must contain at least one pane");
  }
  return (
    splitCockpitPaneWithWorkspace({
      layout: currentLayout,
      targetPaneId,
      position: "right",
      workspaceKey: input.workspaceKey,
      ids: input.ids,
    }) ?? currentLayout
  );
}

function removePaneNode(
  node: SplitNode,
  paneId: string,
): { node: SplitNode | null; removed: SplitPane | null } {
  if (node.kind === "pane") {
    return node.pane.id === paneId ? { node: null, removed: node.pane } : { node, removed: null };
  }

  let removed: SplitPane | null = null;
  const children: SplitNode[] = [];
  for (const child of node.group.children) {
    if (removed) {
      children.push(child);
      continue;
    }
    const childResult = removePaneNode(child, paneId);
    removed = childResult.removed;
    if (childResult.node) children.push(childResult.node);
  }
  if (!removed) return { node, removed: null };
  if (children.length === 0) return { node: null, removed };
  if (children.length === 1) {
    const child = children[0];
    if (!child) throw new Error("Cockpit pane removal left an invalid group");
    return { node: child, removed };
  }
  return {
    removed,
    node: {
      kind: "group",
      group: {
        ...node.group,
        children,
        sizes: equalSizes(children.length),
      },
    },
  };
}

function insertPaneNearTarget(input: {
  node: SplitNode;
  targetPaneId: string;
  pane: SplitPane;
  direction: CockpitPaneMoveDirection;
  ids: CockpitLayoutIdSource;
}): SplitNode | null {
  const axis =
    input.direction === "left" || input.direction === "right" ? "horizontal" : "vertical";
  const insertBefore = input.direction === "left" || input.direction === "up";
  const paneNode: SplitNode = { kind: "pane", pane: input.pane };

  if (input.node.kind === "pane") {
    if (input.node.pane.id !== input.targetPaneId) return null;
    return createGroupNode(
      axis,
      insertBefore ? [paneNode, input.node] : [input.node, paneNode],
      input.ids,
    );
  }

  const directTargetIndex = input.node.group.children.findIndex(
    (child) => child.kind === "pane" && child.pane.id === input.targetPaneId,
  );
  if (directTargetIndex >= 0) {
    const children = input.node.group.children.slice();
    const insertionIndex =
      input.node.group.direction === axis && insertBefore
        ? directTargetIndex
        : directTargetIndex + 1;
    children.splice(insertionIndex, 0, paneNode);
    return {
      kind: "group",
      group: {
        ...input.node.group,
        children,
        sizes: equalSizes(children.length),
      },
    };
  }

  const targetChildIndex = input.node.group.children.findIndex(
    (child) => findCockpitPane(child, input.targetPaneId) !== null,
  );
  if (targetChildIndex < 0) return null;
  const targetChild = input.node.group.children[targetChildIndex];
  if (!targetChild) throw new Error("Cockpit move target index has no child");
  const movedChild = insertPaneNearTarget({ ...input, node: targetChild });
  if (!movedChild) return null;
  const children = input.node.group.children.slice();
  children[targetChildIndex] = movedChild;
  return {
    kind: "group",
    group: {
      ...input.node.group,
      children,
      sizes: equalSizes(children.length),
    },
  };
}

/**
 * Removes a pane from its current group and inserts it into the group reached in
 * the requested direction. This intentionally changes the split tree instead
 * of swapping workspace assignments between two fixed pane slots.
 */
export function moveCockpitPane(input: {
  layout: CockpitLayout;
  paneId: string;
  targetPaneId: string;
  direction: CockpitPaneMoveDirection;
  ids: CockpitLayoutIdSource;
}): CockpitLayout | null {
  if (input.paneId === input.targetPaneId) return null;
  if (!findCockpitPane(input.layout.root, input.targetPaneId)) return null;

  const removed = removePaneNode(input.layout.root, input.paneId);
  if (!removed.removed || !removed.node) return null;
  const root = insertPaneNearTarget({
    node: removed.node,
    targetPaneId: input.targetPaneId,
    pane: removed.removed,
    direction: input.direction,
    ids: input.ids,
  });
  if (!root) return null;
  return { root, focusedPaneId: input.paneId };
}

export interface CloseCockpitPaneResult {
  layout: CockpitLayout | null;
  removedPane: SplitPane;
}

export function closeCockpitPane(
  layout: CockpitLayout,
  paneId: string,
): CloseCockpitPaneResult | null {
  const panesBefore = collectCockpitPanes(layout.root);
  const removedIndex = panesBefore.findIndex((pane) => pane.id === paneId);
  if (removedIndex < 0) return null;
  const result = removePaneNode(layout.root, paneId);
  if (!result.removed) return null;
  if (!result.node) return { layout: null, removedPane: result.removed };
  const remainingPanes = collectCockpitPanes(result.node);
  const fallbackPane = remainingPanes[Math.min(removedIndex, remainingPanes.length - 1)] ?? null;
  const focusedPaneId =
    layout.focusedPaneId === paneId
      ? (fallbackPane?.id ?? null)
      : (findCockpitPane(result.node, layout.focusedPaneId ?? "")?.id ?? fallbackPane?.id ?? null);
  return {
    removedPane: result.removed,
    layout: { root: result.node, focusedPaneId },
  };
}

export function focusCockpitPane(layout: CockpitLayout, paneId: string): CockpitLayout {
  if (layout.focusedPaneId === paneId || !findCockpitPane(layout.root, paneId)) return layout;
  return { ...layout, focusedPaneId: paneId };
}

export function focusCockpitWorkspace(layout: CockpitLayout, workspaceKey: string): CockpitLayout {
  const pane = collectCockpitPanes(layout.root).find(
    (candidate) => getCockpitPaneWorkspaceKey(candidate) === workspaceKey,
  );
  return pane ? focusCockpitPane(layout, pane.id) : layout;
}

function filterNodeForWorkspaces(
  node: SplitNode,
  visibleWorkspaceKeys: ReadonlySet<string>,
): SplitNode | null {
  if (node.kind === "pane") {
    const workspaceKey = getCockpitPaneWorkspaceKey(node.pane);
    return workspaceKey === null || visibleWorkspaceKeys.has(workspaceKey) ? node : null;
  }
  const children = node.group.children.flatMap((child) => {
    const filtered = filterNodeForWorkspaces(child, visibleWorkspaceKeys);
    return filtered ? [filtered] : [];
  });
  if (children.length === 0) return null;
  if (children.length === 1) {
    const child = children[0];
    if (!child) throw new Error("Filtered cockpit group is missing its child");
    return child;
  }
  return {
    kind: "group",
    group: { ...node.group, children, sizes: equalSizes(children.length) },
  };
}

export function filterCockpitLayout(
  layout: CockpitLayout | null,
  visibleWorkspaceKeys: ReadonlySet<string>,
): CockpitLayout | null {
  if (!layout) return null;
  const root = filterNodeForWorkspaces(layout.root, visibleWorkspaceKeys);
  if (!root) return null;
  const focusedPaneId = findCockpitPane(root, layout.focusedPaneId ?? "")
    ? layout.focusedPaneId
    : (collectCockpitPanes(root)[0]?.id ?? null);
  return { root, focusedPaneId };
}

export function getCockpitLayoutMinimumHeight(
  node: SplitNode,
  paneMinHeight = COCKPIT_CARD_MIN_HEIGHT,
  gap = COCKPIT_CARD_GAP,
): number {
  if (node.kind === "pane") return paneMinHeight;
  const childHeights = node.group.children.map((child) =>
    getCockpitLayoutMinimumHeight(child, paneMinHeight, gap),
  );
  if (node.group.direction === "horizontal") return Math.max(...childHeights);
  return (
    childHeights.reduce((total, height) => total + height, 0) + gap * (childHeights.length - 1)
  );
}
