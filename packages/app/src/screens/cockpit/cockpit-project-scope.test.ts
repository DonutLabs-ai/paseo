import { describe, expect, it } from "vitest";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { buildCockpitProjectScopes, resolveActiveCockpitProject } from "./cockpit-project-scope";

function createProject(input: {
  viewKey: string;
  projectName: string;
  workspaceKeys: readonly string[];
}): SidebarProjectEntry {
  return {
    viewKey: input.viewKey,
    projectName: input.projectName,
    projectKind: "git",
    iconWorkingDir: `/projects/${input.viewKey}`,
    hosts: [
      {
        serverId: "host",
        projectId: input.viewKey,
        iconWorkingDir: `/projects/${input.viewKey}`,
        worktreeSupport: "supported",
      },
    ],
    workspaces: input.workspaceKeys.map((workspaceKey) => ({
      workspaceKey,
      serverId: "host",
      workspaceId: workspaceKey.slice("host:".length),
      projectViewKey: input.viewKey,
      projectName: input.projectName,
      projectKind: "git",
      workspaceKind: "checkout",
      name: workspaceKey,
    })),
  };
}

describe("cockpit project scope", () => {
  const backend = createProject({
    viewKey: "backend-project",
    projectName: "DonutLabs-ai/donut-backend",
    workspaceKeys: ["host:backend-a", "host:backend-b"],
  });
  const automations = createProject({
    viewKey: "automations-project",
    projectName: "Paseo Automations",
    workspaceKeys: ["host:automation-a"],
  });

  it("resolves the project that owns the last active workspace", () => {
    const projects = buildCockpitProjectScopes([backend, automations]);

    expect(
      resolveActiveCockpitProject({
        projects,
        preferredWorkspaceKey: "host:backend-b",
      })?.projectViewKey,
    ).toBe("backend-project");
  });

  it("does not include another project's workspaces in the active scope", () => {
    const projects = buildCockpitProjectScopes([backend, automations]);
    const active = resolveActiveCockpitProject({
      projects,
      preferredWorkspaceKey: "host:backend-a",
    });

    expect(active?.workspaceKeys).toEqual(["host:backend-a", "host:backend-b"]);
    expect(active?.workspaceKeys).not.toContain("host:automation-a");
  });

  it("uses the first project when the remembered workspace no longer exists", () => {
    const projects = buildCockpitProjectScopes([backend, automations]);

    expect(
      resolveActiveCockpitProject({
        projects,
        preferredWorkspaceKey: "host:archived",
      })?.projectViewKey,
    ).toBe("backend-project");
  });
});
