import { describe, expect, it } from "vitest";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { CommandCenterIconProps } from "./contributions";
import { buildGroupingContributions, type GroupingCommandCenterSource } from "./root-contributions";

function ProjectIcon(_props: CommandCenterIconProps) {
  return null;
}

function StatusIcon(_props: CommandCenterIconProps) {
  return null;
}

function ProjectStatusIcon(_props: CommandCenterIconProps) {
  return null;
}

function source(groupMode: SidebarGroupMode): {
  value: GroupingCommandCenterSource;
  applied: SidebarGroupMode[];
} {
  const applied: SidebarGroupMode[] = [];
  return {
    value: {
      groupMode,
      labels: {
        section: "Actions",
        groupByProject: "Group by project",
        groupByProjectStatus: "Group by project and status",
        groupByStatus: "Group by status",
      },
      icons: {
        project: ProjectIcon,
        "project-status": ProjectStatusIcon,
        status: StatusIcon,
      },
      setGroupMode: (mode) => applied.push(mode),
    },
    applied,
  };
}

describe("grouping command center contribution", () => {
  it("offers both other choices while grouped by project", () => {
    const fixture = source("project");
    const contributions = buildGroupingContributions(fixture.value);

    expect(contributions.map((contribution) => contribution.presentation)).toMatchObject([
      { title: "Group by project and status", icon: ProjectStatusIcon },
      { title: "Group by status", icon: StatusIcon },
    ]);

    contributions[0]?.run();
    contributions[1]?.run();
    expect(fixture.applied).toEqual(["project-status", "status"]);
  });

  it("offers both project choices while grouped by status", () => {
    const fixture = source("status");
    const contributions = buildGroupingContributions(fixture.value);

    expect(contributions.map((contribution) => contribution.presentation)).toMatchObject([
      { title: "Group by project", icon: ProjectIcon },
      { title: "Group by project and status", icon: ProjectStatusIcon },
    ]);

    contributions[0]?.run();
    contributions[1]?.run();
    expect(fixture.applied).toEqual(["project", "project-status"]);
  });

  it("keeps one stable id per target mode", () => {
    const fromProject = buildGroupingContributions(source("project").value);
    const fromStatus = buildGroupingContributions(source("status").value);

    expect(fromProject.map((contribution) => contribution.id)).toEqual([
      "sidebar-grouping-project-status",
      "sidebar-grouping-status",
    ]);
    expect(fromStatus.map((contribution) => contribution.id)).toEqual([
      "sidebar-grouping-project",
      "sidebar-grouping-project-status",
    ]);
  });

  it("stays out of the default empty-query list", () => {
    for (const mode of ["project", "project-status", "status"] as const) {
      const contributions = buildGroupingContributions(source(mode).value);
      for (const contribution of contributions) {
        expect(contribution.visibility).toBe("query");
        expect(contribution.group).toBe("actions");
        // 6 is keyboard-shortcuts and 7 belongs to the workspace actions in #3013.
        expect(contribution.rank).toBe(8);
      }
    }
  });
});
