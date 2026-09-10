import { describe, expect, it } from "vitest";
import {
  buildProjectStatusSubgroups,
  flattenProjectStatusSubgroups,
  orderProjectWorkspacesByStatus,
} from "./project-status-subgroups";

interface Workspace {
  workspaceKey: string;
}

function workspace(workspaceKey: string): Workspace {
  return { workspaceKey };
}

describe("buildProjectStatusSubgroups", () => {
  it("puts actionable and ready rows above working and done rows inside a project", () => {
    const workspaces = [
      workspace("done"),
      workspace("working"),
      workspace("ready"),
      workspace("failed"),
      workspace("needs-input"),
    ];
    const workspaceEntriesByKey = new Map([
      ["done", { statusBucket: "done" as const }],
      ["working", { statusBucket: "running" as const }],
      ["ready", { statusBucket: "attention" as const }],
      ["failed", { statusBucket: "failed" as const }],
      ["needs-input", { statusBucket: "needs_input" as const }],
    ]);

    const groups = buildProjectStatusSubgroups({ workspaces, workspaceEntriesByKey });

    expect(groups.map((group) => group.bucket)).toEqual([
      "needs_input",
      "failed",
      "attention",
      "running",
      "done",
    ]);
    expect(flattenProjectStatusSubgroups(groups).map((row) => row.workspaceKey)).toEqual([
      "needs-input",
      "failed",
      "ready",
      "working",
      "done",
    ]);
  });

  it("preserves manual order within a status subgroup and omits unhydrated rows", () => {
    const workspaces = [workspace("working-b"), workspace("missing"), workspace("working-a")];
    const workspaceEntriesByKey = new Map([
      ["working-a", { statusBucket: "running" as const }],
      ["working-b", { statusBucket: "running" as const }],
    ]);

    const groups = buildProjectStatusSubgroups({ workspaces, workspaceEntriesByKey });

    expect(groups).toEqual([
      {
        bucket: "running",
        rows: [workspaces[0], workspaces[2]],
      },
    ]);
    expect(orderProjectWorkspacesByStatus({ workspaces, workspaceEntriesByKey })).toEqual([
      workspaces[0],
      workspaces[2],
      workspaces[1],
    ]);
  });
});
