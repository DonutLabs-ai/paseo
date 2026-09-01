import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";

export interface CockpitProjectScope {
  projectViewKey: string;
  projectName: string;
  workspaceKeys: readonly string[];
}

export function buildCockpitProjectScopes(
  projects: readonly SidebarProjectEntry[],
): CockpitProjectScope[] {
  return projects.map((project) => ({
    projectViewKey: project.viewKey,
    projectName: project.projectName,
    workspaceKeys: project.workspaces.map((workspace) => workspace.workspaceKey),
  }));
}

export function resolveActiveCockpitProject(input: {
  projects: readonly CockpitProjectScope[];
  preferredWorkspaceKey: string | null;
}): CockpitProjectScope | null {
  const preferredWorkspaceKey = input.preferredWorkspaceKey;
  if (preferredWorkspaceKey) {
    const preferredProject = input.projects.find((project) =>
      project.workspaceKeys.includes(preferredWorkspaceKey),
    );
    if (preferredProject) return preferredProject;
  }
  return input.projects[0] ?? null;
}
