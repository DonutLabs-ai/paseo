import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { buildCockpitAttentionEntries } from "./cockpit-attention-model";

function workspace(
  input: Partial<SidebarWorkspaceEntry> & {
    workspaceKey: string;
    statusBucket: SidebarWorkspaceEntry["statusBucket"];
  },
): SidebarWorkspaceEntry {
  return {
    workspaceKey: input.workspaceKey,
    serverId: "srv",
    workspaceId: input.workspaceKey,
    projectViewKey: "project",
    projectName: "Project",
    projectRootPath: "/repo/project",
    workspaceDirectory: "/repo/project/workspace",
    workspaceDirectoryLabel: "workspace",
    projectKind: "git",
    workspaceKind: "worktree",
    name: input.workspaceKey,
    title: null,
    currentBranch: null,
    statusBucket: input.statusBucket,
    statusEnteredAt: input.statusEnteredAt ?? null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    agentId: input.agentId ?? "agent-1",
    latestPrompt: null,
    latestReply: null,
    recentReplies: [],
    activityPreview: null,
    activityPreviewKind: null,
  };
}

describe("cockpit attention center", () => {
  it("keeps urgent snoozed workspaces but suppresses snoozed finished work", () => {
    const needsInput = workspace({
      workspaceKey: "srv:needs-input",
      statusBucket: "needs_input",
    });
    const finished = workspace({ workspaceKey: "srv:finished", statusBucket: "attention" });

    const entries = buildCockpitAttentionEntries({
      workspaces: [finished, needsInput],
      snoozedAtByWorkspace: {
        [finished.workspaceKey]: "2026-08-30T00:00:00.000Z",
        [needsInput.workspaceKey]: "2026-08-30T00:00:00.000Z",
      },
    });

    expect(entries.map((entry) => entry.workspace.workspaceKey)).toEqual([needsInput.workspaceKey]);
  });

  it("orders input before failures before finished, oldest first within a priority", () => {
    const entries = buildCockpitAttentionEntries({
      workspaces: [
        workspace({
          workspaceKey: "srv:input-new",
          statusBucket: "needs_input",
          statusEnteredAt: new Date("2026-08-30T02:00:00.000Z"),
        }),
        workspace({ workspaceKey: "srv:finished", statusBucket: "attention" }),
        workspace({ workspaceKey: "srv:failed", statusBucket: "failed" }),
        workspace({
          workspaceKey: "srv:input-old",
          statusBucket: "needs_input",
          statusEnteredAt: new Date("2026-08-30T01:00:00.000Z"),
        }),
      ],
      snoozedAtByWorkspace: {},
    });

    expect(entries.map((entry) => entry.workspace.workspaceKey)).toEqual([
      "srv:input-old",
      "srv:input-new",
      "srv:failed",
      "srv:finished",
    ]);
  });
});
