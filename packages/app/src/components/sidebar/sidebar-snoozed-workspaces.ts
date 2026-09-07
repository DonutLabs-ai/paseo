import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";

export interface SnoozedSidebarContent {
  projects: SidebarProjectEntry[];
  pinnedGroups: PinnedSidebarGroups;
  workspaceGroups: SidebarWorkspaceGroup[];
  snoozedWorkspaces: SidebarWorkspaceEntry[];
}

function projectsWithoutSnoozedWorkspaces(
  projects: SidebarProjectEntry[],
  snoozedWorkspaceKeys: ReadonlySet<string>,
): SidebarProjectEntry[] {
  let changed = false;
  const filtered = projects.map((project) => {
    const workspaces = project.workspaces.filter(
      (workspace) => !snoozedWorkspaceKeys.has(workspace.workspaceKey),
    );
    if (workspaces.length === project.workspaces.length) {
      return project;
    }
    changed = true;
    return { ...project, workspaces };
  });
  return changed ? filtered : projects;
}

function workspaceGroupsWithoutSnoozedWorkspaces(
  groups: SidebarWorkspaceGroup[],
  snoozedWorkspaceKeys: ReadonlySet<string>,
): SidebarWorkspaceGroup[] {
  let changed = false;
  const filtered: SidebarWorkspaceGroup[] = [];
  for (const group of groups) {
    const rows = group.rows.filter(
      (workspace) => !snoozedWorkspaceKeys.has(workspace.workspaceKey),
    );
    if (rows.length === 0) {
      changed = true;
      continue;
    }
    if (rows.length === group.rows.length) {
      filtered.push(group);
      continue;
    }
    changed = true;
    filtered.push({ ...group, rows });
  }
  return changed ? filtered : groups;
}

export function splitSnoozedSidebarContent(input: {
  projects: SidebarProjectEntry[];
  pinnedGroups: PinnedSidebarGroups;
  workspaceGroups: SidebarWorkspaceGroup[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  snoozedAtByWorkspace: Readonly<Record<string, string>>;
}): SnoozedSidebarContent {
  const persistedSnoozedKeys = new Set(Object.keys(input.snoozedAtByWorkspace));
  const snoozedWorkspaceKeys = new Set<string>();
  const snoozedWorkspaces: SidebarWorkspaceEntry[] = [];

  for (const project of input.projects) {
    for (const placement of project.workspaces) {
      if (
        snoozedWorkspaceKeys.has(placement.workspaceKey) ||
        !persistedSnoozedKeys.has(placement.workspaceKey)
      ) {
        continue;
      }
      const workspace = input.workspaceEntriesByKey.get(placement.workspaceKey);
      if (!workspace) {
        continue;
      }
      snoozedWorkspaceKeys.add(placement.workspaceKey);
      snoozedWorkspaces.push(workspace);
    }
  }

  if (snoozedWorkspaceKeys.size === 0) {
    return {
      projects: input.projects,
      pinnedGroups: input.pinnedGroups,
      workspaceGroups: input.workspaceGroups,
      snoozedWorkspaces,
    };
  }

  const pinnedChats = input.pinnedGroups.pinnedChats.filter(
    (workspace) => !snoozedWorkspaceKeys.has(workspace.workspaceKey),
  );
  const unpinnedProjects = projectsWithoutSnoozedWorkspaces(
    input.pinnedGroups.unpinnedProjects,
    snoozedWorkspaceKeys,
  );
  const pinnedGroups =
    pinnedChats.length === input.pinnedGroups.pinnedChats.length &&
    unpinnedProjects === input.pinnedGroups.unpinnedProjects
      ? input.pinnedGroups
      : { pinnedChats, unpinnedProjects };

  return {
    projects: projectsWithoutSnoozedWorkspaces(input.projects, snoozedWorkspaceKeys),
    pinnedGroups,
    workspaceGroups: workspaceGroupsWithoutSnoozedWorkspaces(
      input.workspaceGroups,
      snoozedWorkspaceKeys,
    ),
    snoozedWorkspaces,
  };
}
