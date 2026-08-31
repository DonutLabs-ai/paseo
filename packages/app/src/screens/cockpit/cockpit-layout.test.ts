import { describe, expect, it } from "vitest";
import {
  addWorkspaceToCockpitLayout,
  closeCockpitPane,
  collectCockpitPanes,
  createDefaultCockpitLayout,
  filterCockpitLayout,
  getCockpitPaneMoveTarget,
  getCockpitPaneWorkspaceKey,
  moveCockpitPane,
  splitCockpitPane,
  type CockpitLayoutIdSource,
} from "./cockpit-layout";

function createIds(): CockpitLayoutIdSource {
  let nextId = 1;
  return {
    createNodeId: (prefix) => `${prefix}-${nextId++}`,
  };
}

function requireLayout<T>(value: T | null): T {
  if (!value) throw new Error("Expected cockpit layout");
  return value;
}

function requireItem<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected cockpit layout item");
  return value;
}

describe("cockpit pane layout", () => {
  it("builds a balanced default grid and focuses the active workspace", () => {
    const layout = requireLayout(
      createDefaultCockpitLayout({
        workspaceKeys: ["a", "b", "c", "d", "e"],
        preferredWorkspaceKey: "d",
        ids: createIds(),
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected row group");
    expect(layout.root.group.direction).toBe("vertical");
    expect(
      layout.root.group.children.map((row) =>
        row.kind === "group" ? row.group.children.length : 1,
      ),
    ).toEqual([3, 2]);
    const focusedPane = collectCockpitPanes(layout.root).find(
      (pane) => pane.id === layout.focusedPaneId,
    );
    expect(focusedPane && getCockpitPaneWorkspaceKey(focusedPane)).toBe("d");
  });

  it("splits right into the current row and redistributes every width equally", () => {
    const ids = createIds();
    const initial = requireLayout(createDefaultCockpitLayout({ workspaceKeys: ["a", "b"], ids }));
    const targetPaneId = requireItem(collectCockpitPanes(initial.root)[0]).id;
    const layout = requireLayout(
      splitCockpitPane({
        layout: initial,
        targetPaneId,
        position: "right",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected horizontal group");
    expect(layout.root.group.direction).toBe("horizontal");
    expect(layout.root.group.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(collectCockpitPanes(layout.root).map(getCockpitPaneWorkspaceKey)).toEqual([
      "a",
      null,
      "b",
    ]);
    expect(layout.focusedPaneId).toBe(requireItem(collectCockpitPanes(layout.root)[1]).id);
  });

  it("splits right into the existing outer row when the target is nested in a column", () => {
    const ids = createIds();
    const initial = requireLayout(createDefaultCockpitLayout({ workspaceKeys: ["a", "b"], ids }));
    const targetPaneId = requireItem(collectCockpitPanes(initial.root)[0]).id;
    const nested = requireLayout(
      splitCockpitPane({
        layout: initial,
        targetPaneId,
        position: "down",
        ids,
      }),
    );
    const layout = requireLayout(
      splitCockpitPane({
        layout: nested,
        targetPaneId,
        position: "right",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected horizontal root");
    expect(layout.root.group.direction).toBe("horizontal");
    expect(layout.root.group.children).toHaveLength(3);
    expect(layout.root.group.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);

    const firstColumn = requireItem(layout.root.group.children[0]);
    expect(firstColumn.kind).toBe("group");
    if (firstColumn.kind !== "group") throw new Error("Expected nested vertical column");
    expect(firstColumn.group.direction).toBe("vertical");
    expect(collectCockpitPanes(firstColumn).map(getCockpitPaneWorkspaceKey)).toEqual(["a", null]);

    const newPane = requireItem(layout.root.group.children[1]);
    expect(newPane.kind).toBe("pane");
    if (newPane.kind !== "pane") throw new Error("Expected new pane in the outer row");
    expect(newPane.pane.id).toBe(layout.focusedPaneId);
    expect(getCockpitPaneWorkspaceKey(newPane.pane)).toBeNull();

    const lastPane = requireItem(layout.root.group.children[2]);
    expect(lastPane.kind).toBe("pane");
    if (lastPane.kind !== "pane") throw new Error("Expected existing pane at the end of the row");
    expect(getCockpitPaneWorkspaceKey(lastPane.pane)).toBe("b");
  });

  it("splits down by nesting a vertical group beneath the target column", () => {
    const ids = createIds();
    const initial = requireLayout(createDefaultCockpitLayout({ workspaceKeys: ["a", "b"], ids }));
    const targetPaneId = requireItem(collectCockpitPanes(initial.root)[0]).id;
    const layout = requireLayout(
      splitCockpitPane({
        layout: initial,
        targetPaneId,
        position: "down",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected horizontal root");
    expect(layout.root.group.direction).toBe("horizontal");
    const firstColumn = requireItem(layout.root.group.children[0]);
    expect(firstColumn.kind).toBe("group");
    if (firstColumn.kind !== "group") throw new Error("Expected vertical column");
    expect(firstColumn.group.direction).toBe("vertical");
    expect(firstColumn.group.sizes).toEqual([0.5, 0.5]);
  });

  it("splits down into the current column and redistributes every height equally", () => {
    const ids = createIds();
    const initial = requireLayout(createDefaultCockpitLayout({ workspaceKeys: ["a"], ids }));
    if (!initial.focusedPaneId) throw new Error("Expected focused cockpit pane");
    const firstSplit = requireLayout(
      splitCockpitPane({
        layout: initial,
        targetPaneId: initial.focusedPaneId,
        position: "down",
        ids,
      }),
    );
    if (!firstSplit.focusedPaneId) throw new Error("Expected focused split pane");
    const layout = requireLayout(
      splitCockpitPane({
        layout: firstSplit,
        targetPaneId: firstSplit.focusedPaneId,
        position: "down",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected vertical group");
    expect(layout.root.group.direction).toBe("vertical");
    expect(layout.root.group.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(collectCockpitPanes(layout.root).map(getCockpitPaneWorkspaceKey)).toEqual([
      "a",
      null,
      null,
    ]);
  });

  it("splits down into the existing outer column when the target is nested in a row", () => {
    const ids = createIds();
    const initial = requireLayout(
      createDefaultCockpitLayout({ workspaceKeys: ["a", "b"], maxColumns: 1, ids }),
    );
    const targetPaneId = requireItem(collectCockpitPanes(initial.root)[0]).id;
    const nested = requireLayout(
      splitCockpitPane({
        layout: initial,
        targetPaneId,
        position: "right",
        ids,
      }),
    );
    const layout = requireLayout(
      splitCockpitPane({
        layout: nested,
        targetPaneId,
        position: "down",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected vertical root");
    expect(layout.root.group.direction).toBe("vertical");
    expect(layout.root.group.children).toHaveLength(3);
    expect(layout.root.group.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);

    const firstRow = requireItem(layout.root.group.children[0]);
    expect(firstRow.kind).toBe("group");
    if (firstRow.kind !== "group") throw new Error("Expected nested horizontal row");
    expect(firstRow.group.direction).toBe("horizontal");
    expect(collectCockpitPanes(firstRow).map(getCockpitPaneWorkspaceKey)).toEqual(["a", null]);

    const newPane = requireItem(layout.root.group.children[1]);
    expect(newPane.kind).toBe("pane");
    if (newPane.kind !== "pane") throw new Error("Expected new pane in the outer column");
    expect(newPane.pane.id).toBe(layout.focusedPaneId);
    expect(getCockpitPaneWorkspaceKey(newPane.pane)).toBeNull();

    const lastPane = requireItem(layout.root.group.children[2]);
    expect(lastPane.kind).toBe("pane");
    if (lastPane.kind !== "pane")
      throw new Error("Expected existing pane at the end of the column");
    expect(getCockpitPaneWorkspaceKey(lastPane.pane)).toBe("b");
  });

  it("fills a reserved empty pane with the next new workspace", () => {
    const ids = createIds();
    const initial = requireLayout(createDefaultCockpitLayout({ workspaceKeys: ["a"], ids }));
    if (!initial.focusedPaneId) throw new Error("Expected focused cockpit pane");
    const emptyLayout = requireLayout(
      splitCockpitPane({
        layout: initial,
        targetPaneId: initial.focusedPaneId,
        position: "right",
        ids,
      }),
    );
    const layout = addWorkspaceToCockpitLayout({
      layout: emptyLayout,
      workspaceKey: "b",
      ids,
    });

    expect(collectCockpitPanes(layout.root).map(getCockpitPaneWorkspaceKey)).toEqual(["a", "b"]);
  });

  it("fills the focused placeholder when more than one empty pane exists", () => {
    const ids = createIds();
    const initial = requireLayout(createDefaultCockpitLayout({ workspaceKeys: ["a"], ids }));
    if (!initial.focusedPaneId) throw new Error("Expected focused cockpit pane");
    const rightSplit = requireLayout(
      splitCockpitPane({
        layout: initial,
        targetPaneId: initial.focusedPaneId,
        position: "right",
        ids,
      }),
    );
    if (!rightSplit.focusedPaneId) throw new Error("Expected focused right pane");
    const downSplit = requireLayout(
      splitCockpitPane({
        layout: rightSplit,
        targetPaneId: rightSplit.focusedPaneId,
        position: "down",
        ids,
      }),
    );
    const layout = addWorkspaceToCockpitLayout({
      layout: downSplit,
      workspaceKey: "b",
      ids,
    });

    expect(collectCockpitPanes(layout.root).map(getCockpitPaneWorkspaceKey)).toEqual([
      "a",
      null,
      "b",
    ]);
  });

  it("closes a pane, collapses single-child groups, and equalizes survivors", () => {
    const ids = createIds();
    const initial = requireLayout(
      createDefaultCockpitLayout({ workspaceKeys: ["a", "b", "c"], ids }),
    );
    const middlePaneId = requireItem(collectCockpitPanes(initial.root)[1]).id;
    const result = requireLayout(closeCockpitPane(initial, middlePaneId));
    const layout = requireLayout(result.layout);

    expect(getCockpitPaneWorkspaceKey(result.removedPane)).toBe("b");
    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected horizontal group");
    expect(layout.root.group.sizes).toEqual([0.5, 0.5]);
    expect(collectCockpitPanes(layout.root).map(getCockpitPaneWorkspaceKey)).toEqual(["a", "c"]);
  });

  it("moves a card into the adjacent row without swapping workspace assignments", () => {
    const ids = createIds();
    const initial = requireLayout(
      createDefaultCockpitLayout({
        workspaceKeys: ["a", "b", "c", "d", "e", "f"],
        ids,
      }),
    );
    const panes = collectCockpitPanes(initial.root);
    const targetPane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "b"));
    const movedPane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "e"));
    const layout = requireLayout(
      moveCockpitPane({
        layout: initial,
        paneId: movedPane.id,
        targetPaneId: targetPane.id,
        direction: "up",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected vertical root group");
    expect(
      layout.root.group.children.map((row) =>
        collectCockpitPanes(row).map(getCockpitPaneWorkspaceKey),
      ),
    ).toEqual([
      ["a", "b", "e", "c"],
      ["d", "f"],
    ]);
    expect(layout.root.group.children[0]?.kind).toBe("group");
    const firstRow = requireItem(layout.root.group.children[0]);
    if (firstRow.kind !== "group") throw new Error("Expected first row group");
    expect(firstRow.group.sizes).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(layout.focusedPaneId).toBe(movedPane.id);
  });

  it("joins a single-card target row instead of exchanging the two rows", () => {
    const ids = createIds();
    const initial = requireLayout(
      createDefaultCockpitLayout({
        workspaceKeys: ["a", "b"],
        maxColumns: 1,
        ids,
      }),
    );
    const panes = collectCockpitPanes(initial.root);
    const sourcePane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "a"));
    const targetPane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "b"));
    const layout = requireLayout(
      moveCockpitPane({
        layout: initial,
        paneId: sourcePane.id,
        targetPaneId: targetPane.id,
        direction: "down",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected target row group");
    expect(layout.root.group.direction).toBe("horizontal");
    expect(collectCockpitPanes(layout.root).map(getCockpitPaneWorkspaceKey)).toEqual(["b", "a"]);
  });

  it("moves a middle single-card row into the existing row below", () => {
    const ids = createIds();
    const initial = requireLayout(
      createDefaultCockpitLayout({
        workspaceKeys: ["a", "b", "c"],
        maxColumns: 1,
        ids,
      }),
    );
    const panes = collectCockpitPanes(initial.root);
    const sourcePane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "b"));
    const targetPane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "c"));
    const layout = requireLayout(
      moveCockpitPane({
        layout: initial,
        paneId: sourcePane.id,
        targetPaneId: targetPane.id,
        direction: "down",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected vertical root group");
    expect(layout.root.group.direction).toBe("vertical");
    expect(
      layout.root.group.children.map((row) =>
        collectCockpitPanes(row).map(getCockpitPaneWorkspaceKey),
      ),
    ).toEqual([["a"], ["c", "b"]]);
    const targetRow = requireItem(layout.root.group.children[1]);
    expect(targetRow.kind).toBe("group");
    if (targetRow.kind !== "group") throw new Error("Expected horizontal target row");
    expect(targetRow.group.direction).toBe("horizontal");
  });

  it("moves a card into the adjacent column without swapping workspace assignments", () => {
    const ids = createIds();
    const initial = requireLayout(
      createDefaultCockpitLayout({ workspaceKeys: ["a", "b", "c"], ids }),
    );
    const panes = collectCockpitPanes(initial.root);
    const sourcePane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "a"));
    const targetPane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "b"));
    const layout = requireLayout(
      moveCockpitPane({
        layout: initial,
        paneId: sourcePane.id,
        targetPaneId: targetPane.id,
        direction: "right",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected horizontal root group");
    expect(layout.root.group.direction).toBe("horizontal");
    const targetColumn = requireItem(layout.root.group.children[0]);
    expect(targetColumn.kind).toBe("group");
    if (targetColumn.kind !== "group") throw new Error("Expected vertical target column");
    expect(targetColumn.group.direction).toBe("vertical");
    expect(collectCockpitPanes(targetColumn).map(getCockpitPaneWorkspaceKey)).toEqual(["b", "a"]);
    expect(
      collectCockpitPanes(requireItem(layout.root.group.children[1])).map(
        getCockpitPaneWorkspaceKey,
      ),
    ).toEqual(["c"]);
  });

  it("moves a bottom-edge card into a new row without redistributing the other rows", () => {
    const ids = createIds();
    const initial = requireLayout(
      createDefaultCockpitLayout({
        workspaceKeys: ["a", "b", "c", "d", "e", "f"],
        ids,
      }),
    );
    const movedPane = requireItem(
      collectCockpitPanes(initial.root).find((pane) => getCockpitPaneWorkspaceKey(pane) === "e"),
    );
    const layout = requireLayout(
      moveCockpitPane({
        layout: initial,
        paneId: movedPane.id,
        targetPaneId: null,
        direction: "down",
        ids,
      }),
    );

    expect(layout.root.kind).toBe("group");
    if (layout.root.kind !== "group") throw new Error("Expected vertical root group");
    expect(layout.root.group.direction).toBe("vertical");
    expect(
      layout.root.group.children.map((row) =>
        collectCockpitPanes(row).map(getCockpitPaneWorkspaceKey),
      ),
    ).toEqual([["a", "b", "c"], ["d", "f"], ["e"]]);
    expect(layout.focusedPaneId).toBe(movedPane.id);
  });

  it.each([
    {
      direction: "up" as const,
      workspaceKey: "b",
      rootDirection: "vertical",
      sections: [["b"], ["a", "c"], ["d", "e", "f"]],
    },
    {
      direction: "left" as const,
      workspaceKey: "d",
      rootDirection: "horizontal",
      sections: [["d"], ["a", "b", "c", "e", "f"]],
    },
    {
      direction: "right" as const,
      workspaceKey: "c",
      rootDirection: "horizontal",
      sections: [["a", "b", "d", "e", "f"], ["c"]],
    },
  ])(
    "moves a $direction-edge card into a new outer row or column",
    ({ direction, workspaceKey, rootDirection, sections }) => {
      const ids = createIds();
      const initial = requireLayout(
        createDefaultCockpitLayout({
          workspaceKeys: ["a", "b", "c", "d", "e", "f"],
          ids,
        }),
      );
      const movedPane = requireItem(
        collectCockpitPanes(initial.root).find(
          (pane) => getCockpitPaneWorkspaceKey(pane) === workspaceKey,
        ),
      );
      const layout = requireLayout(
        moveCockpitPane({
          layout: initial,
          paneId: movedPane.id,
          targetPaneId: null,
          direction,
          ids,
        }),
      );

      expect(layout.root.kind).toBe("group");
      if (layout.root.kind !== "group") throw new Error("Expected root group");
      expect(layout.root.group.direction).toBe(rootDirection);
      expect(
        layout.root.group.children.map((section) =>
          collectCockpitPanes(section).map(getCockpitPaneWorkspaceKey),
        ),
      ).toEqual(sections);
    },
  );

  it("exposes an edge move target when no adjacent pane exists", () => {
    const layout = requireLayout(
      createDefaultCockpitLayout({
        workspaceKeys: ["a", "b", "c", "d", "e", "f"],
        ids: createIds(),
      }),
    );
    const panes = collectCockpitPanes(layout.root);
    const bottomPane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "e"));
    const leftPane = requireItem(panes.find((pane) => getCockpitPaneWorkspaceKey(pane) === "d"));

    expect(getCockpitPaneMoveTarget(layout.root, bottomPane.id, "down")).toEqual({
      kind: "edge",
    });
    expect(getCockpitPaneMoveTarget(layout.root, bottomPane.id, "left")).toEqual({
      kind: "pane",
      paneId: leftPane.id,
    });
  });

  it("disables edge moves when the cockpit contains only one card", () => {
    const layout = requireLayout(
      createDefaultCockpitLayout({ workspaceKeys: ["a"], ids: createIds() }),
    );
    const pane = requireItem(collectCockpitPanes(layout.root)[0]);

    expect(getCockpitPaneMoveTarget(layout.root, pane.id, "down")).toBeNull();
  });

  it("filters cards without mutating the persisted layout topology", () => {
    const layout = requireLayout(
      createDefaultCockpitLayout({
        workspaceKeys: ["a", "b", "c"],
        ids: createIds(),
      }),
    );
    const presented = requireLayout(filterCockpitLayout(layout, new Set(["a", "c"])));

    expect(collectCockpitPanes(presented.root).map(getCockpitPaneWorkspaceKey)).toEqual(["a", "c"]);
    expect(collectCockpitPanes(layout.root).map(getCockpitPaneWorkspaceKey)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
