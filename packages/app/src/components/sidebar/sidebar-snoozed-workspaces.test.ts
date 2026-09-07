import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import { splitSnoozedSidebarContent } from "./sidebar-snoozed-workspaces";

function workspace(workspaceKey: string, projectViewKey: string): SidebarWorkspaceEntry {
  const [serverId, workspaceId] = workspaceKey.split(":");
  if (!serverId || !workspaceId) {
    throw new Error(`Invalid workspace key: ${workspaceKey}`);
  }
  return {
    workspaceKey,
    serverId,
    workspaceId,
    projectViewKey,
    projectName: projectViewKey,
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    workspaceDirectoryLabel: "/repo",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: workspaceId,
    title: null,
    pinnedAt: null,
    labels: [],
    currentBranch: "main",
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: false,
    archiveUnpushedCommitCount: 0,
    scripts: [],
    hasRunningScripts: false,
    agentId: workspaceId,
    latestPrompt: null,
    latestReply: null,
    recentReplies: [],
    activityPreview: null,
    activityPreviewKind: null,
  };
}

function project(viewKey: string, workspaces: SidebarWorkspaceEntry[]): SidebarProjectEntry {
  return {
    viewKey,
    projectName: viewKey,
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [],
    workspaces,
  };
}

function projectWorkspaceKeys(projects: SidebarProjectEntry[]): string[][] {
  return projects.map((item) => item.workspaces.map((entry) => entry.workspaceKey));
}

describe("splitSnoozedSidebarContent", () => {
  it("removes snoozed workspaces from regular groups and returns one dedicated ordered list", () => {
    const active = workspace("host:active", "project-a");
    const snoozedPinned = workspace("host:snoozed-pinned", "project-a");
    const snoozedRegular = workspace("host:snoozed-regular", "project-b");
    const projects = [
      project("project-a", [active, snoozedPinned]),
      project("project-b", [snoozedRegular]),
    ];
    const pinnedGroups: PinnedSidebarGroups = {
      pinnedChats: [snoozedPinned],
      unpinnedProjects: [project("project-a", [active]), project("project-b", [snoozedRegular])],
    };
    const workspaceGroups: SidebarWorkspaceGroup[] = [
      {
        key: "done",
        label: "Done",
        rows: [active, snoozedPinned, snoozedRegular],
        leading: { kind: "status", bucket: "done" },
      },
    ];
    const workspaceEntriesByKey = new Map(
      [active, snoozedPinned, snoozedRegular].map((entry) => [entry.workspaceKey, entry]),
    );

    const result = splitSnoozedSidebarContent({
      projects,
      pinnedGroups,
      workspaceGroups,
      workspaceEntriesByKey,
      snoozedAtByWorkspace: {
        [snoozedPinned.workspaceKey]: "2026-09-07T01:00:00.000Z",
        [snoozedRegular.workspaceKey]: "2026-09-07T02:00:00.000Z",
        "host:stale-workspace": "2026-09-07T03:00:00.000Z",
      },
    });

    expect(projectWorkspaceKeys(result.projects)).toEqual([[active.workspaceKey], []]);
    expect(result.pinnedGroups.pinnedChats).toEqual([]);
    expect(projectWorkspaceKeys(result.pinnedGroups.unpinnedProjects)).toEqual([
      [active.workspaceKey],
      [],
    ]);
    expect(result.workspaceGroups).toEqual([
      {
        ...workspaceGroups[0],
        rows: [active],
      },
    ]);
    expect(result.snoozedWorkspaces).toEqual([snoozedPinned, snoozedRegular]);
  });

  it("preserves existing references when no visible workspace is snoozed", () => {
    const active = workspace("host:active", "project-a");
    const projects = [project("project-a", [active])];
    const pinnedGroups: PinnedSidebarGroups = {
      pinnedChats: [],
      unpinnedProjects: projects,
    };
    const workspaceGroups: SidebarWorkspaceGroup[] = [
      {
        key: "done",
        label: "Done",
        rows: [active],
        leading: { kind: "status", bucket: "done" },
      },
    ];

    const result = splitSnoozedSidebarContent({
      projects,
      pinnedGroups,
      workspaceGroups,
      workspaceEntriesByKey: new Map([[active.workspaceKey, active]]),
      snoozedAtByWorkspace: { "host:stale-workspace": "2026-09-07T03:00:00.000Z" },
    });

    expect(result.projects).toBe(projects);
    expect(result.pinnedGroups).toBe(pinnedGroups);
    expect(result.workspaceGroups).toBe(workspaceGroups);
    expect(result.snoozedWorkspaces).toEqual([]);
  });
});
