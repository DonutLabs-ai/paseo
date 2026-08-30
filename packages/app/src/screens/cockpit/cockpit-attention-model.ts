import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

const ATTENTION_PRIORITY = {
  needs_input: 0,
  failed: 1,
  attention: 2,
} as const;

export interface CockpitAttentionEntry {
  workspace: SidebarWorkspaceEntry;
  priority: number;
}

function attentionPriority(workspace: SidebarWorkspaceEntry): number | null {
  if (workspace.statusBucket === "needs_input") return ATTENTION_PRIORITY.needs_input;
  if (workspace.statusBucket === "failed") return ATTENTION_PRIORITY.failed;
  if (workspace.statusBucket === "attention") return ATTENTION_PRIORITY.attention;
  return null;
}

export function buildCockpitAttentionEntries(input: {
  workspaces: readonly SidebarWorkspaceEntry[];
  snoozedAtByWorkspace: Readonly<Record<string, string>>;
}): CockpitAttentionEntry[] {
  const entries = input.workspaces.flatMap((workspace) => {
    const priority = attentionPriority(workspace);
    if (priority === null || !workspace.agentId) return [];
    const isSnoozed = Boolean(input.snoozedAtByWorkspace[workspace.workspaceKey]);
    const suppressFinished = workspace.statusBucket === "attention" && isSnoozed;
    return suppressFinished ? [] : [{ workspace, priority }];
  });
  entries.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    const leftTime = left.workspace.statusEnteredAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightTime = right.workspace.statusEnteredAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.workspace.workspaceKey.localeCompare(right.workspace.workspaceKey);
  });
  return entries;
}
