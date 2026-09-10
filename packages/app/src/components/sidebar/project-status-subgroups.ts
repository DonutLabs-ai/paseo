import type { StatusBucket } from "@/hooks/sidebar-status-view-model";
import { STATUS_BUCKET_ORDER } from "@/utils/sidebar-agent-state";

interface ProjectWorkspaceStatus {
  statusBucket: StatusBucket;
}

export interface ProjectStatusSubgroup<T> {
  bucket: StatusBucket;
  rows: T[];
}

/** Groups one project's rows by status while preserving their manual order inside each bucket. */
export function buildProjectStatusSubgroups<T extends { workspaceKey: string }>(input: {
  workspaces: readonly T[];
  workspaceEntriesByKey: ReadonlyMap<string, ProjectWorkspaceStatus>;
}): ProjectStatusSubgroup<T>[] {
  const rowsByBucket = new Map<StatusBucket, T[]>();

  for (const workspace of input.workspaces) {
    const entry = input.workspaceEntriesByKey.get(workspace.workspaceKey);
    if (!entry) continue;

    const rows = rowsByBucket.get(entry.statusBucket);
    if (rows) {
      rows.push(workspace);
    } else {
      rowsByBucket.set(entry.statusBucket, [workspace]);
    }
  }

  return STATUS_BUCKET_ORDER.flatMap((bucket) => {
    const rows = rowsByBucket.get(bucket);
    return rows && rows.length > 0 ? [{ bucket, rows }] : [];
  });
}

export function flattenProjectStatusSubgroups<T>(groups: readonly ProjectStatusSubgroup<T>[]): T[] {
  return groups.flatMap((group) => group.rows);
}

/** Produces project-mode visual order without dropping structural rows during hydration. */
export function orderProjectWorkspacesByStatus<T extends { workspaceKey: string }>(input: {
  workspaces: readonly T[];
  workspaceEntriesByKey: ReadonlyMap<string, ProjectWorkspaceStatus>;
}): T[] {
  const ordered = flattenProjectStatusSubgroups(buildProjectStatusSubgroups(input));
  const orderedKeys = new Set(ordered.map((workspace) => workspace.workspaceKey));
  return [
    ...ordered,
    ...input.workspaces.filter((workspace) => !orderedKeys.has(workspace.workspaceKey)),
  ];
}
