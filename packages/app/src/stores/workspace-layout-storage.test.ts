import { describe, expect, it } from "vitest";
import { WorkspaceLayoutPersistedStateSchema } from "./workspace-layout-storage";

describe("WorkspaceLayoutPersistedStateSchema", () => {
  it("preserves a References tab in the Explorer sidebar", () => {
    const persisted = WorkspaceLayoutPersistedStateSchema.parse({
      layoutByWorkspace: {
        "server:workspace": {
          root: {
            kind: "pane",
            pane: {
              id: "explorer",
              tabIds: ["references"],
              focusedTabId: "references",
              tabs: [
                {
                  tabId: "references",
                  target: { kind: "references" },
                  createdAt: 1,
                },
              ],
            },
          },
          focusedPaneId: null,
        },
      },
    });

    expect(JSON.stringify(persisted.layoutByWorkspace["server:workspace"])).toContain(
      '"target":{"kind":"references"}',
    );
  });
});
