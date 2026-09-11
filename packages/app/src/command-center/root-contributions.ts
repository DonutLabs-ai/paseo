import { SIDEBAR_GROUP_MODES, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface GroupingCommandCenterSource {
  groupMode: SidebarGroupMode;
  labels: {
    section: string;
    groupByProject: string;
    groupByProjectStatus: string;
    groupByStatus: string;
  };
  icons: Partial<Record<SidebarGroupMode, CommandCenterIcon>>;
  setGroupMode(mode: SidebarGroupMode): void;
}

// One entry per other mode makes all three choices directly reachable without offering a no-op.
export function buildGroupingContributions(
  source: GroupingCommandCenterSource,
): CommandCenterContribution[] {
  const titleByMode: Record<SidebarGroupMode, string> = {
    project: source.labels.groupByProject,
    "project-status": source.labels.groupByProjectStatus,
    status: source.labels.groupByStatus,
  };

  return SIDEBAR_GROUP_MODES.filter((target) => target !== source.groupMode).map((target) => ({
    id: `sidebar-grouping-${target}`,
    group: "actions",
    groupRank: 0,
    rank: 8,
    keywords: ["group", "grouping", "sort", "sidebar", "project", "status"],
    visibility: "query",
    run: () => source.setGroupMode(target),
    presentation: {
      kind: "action",
      title: titleByMode[target],
      sectionTitle: source.labels.section,
      icon: source.icons[target],
    },
  }));
}
