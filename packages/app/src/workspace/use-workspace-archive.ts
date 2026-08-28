import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import {
  buildWorktreeArchiveConfirmationMessage,
  DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
  type WorktreeArchiveWarningLabels,
} from "@/git/worktree-archive-warning";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { archiveWorkspaceOptimistically } from "@/workspace/workspace-archive";
import { confirmDialog } from "@/utils/confirm-dialog";

function purgeArchivedWorkspaceState(input: { serverId: string; workspaceId: string }): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (workspaceKey) {
    useWorkspaceLayoutStore.getState().purgeWorkspace(workspaceKey);
  }
}

export interface ArchiveWorkspaceInput {
  serverId: string;
  workspaceId: string;
  workspaceKind: WorkspaceDescriptor["workspaceKind"];
  name: string;
  isDirty?: boolean | null;
  aheadOfOrigin?: number | null;
  diffStat?: { additions: number; deletions: number } | null;
  warningLabels?: WorktreeArchiveWarningLabels;
  confirmationPolicy?: "risky-worktree" | "always";
  onArchiveStarted: () => void;
  onArchiveSucceeded?: () => void;
  onSetHiding?: (hiding: boolean) => void;
}

export interface WorkspaceArchiveController {
  archive: () => void;
}

export function useWorkspaceArchive(input: ArchiveWorkspaceInput): WorkspaceArchiveController {
  const {
    serverId,
    workspaceId,
    workspaceKind,
    name,
    isDirty,
    aheadOfOrigin,
    diffStat,
    warningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
    confirmationPolicy = "risky-worktree",
    onArchiveStarted,
    onArchiveSucceeded,
    onSetHiding,
  } = input;
  const { t } = useTranslation();
  const toast = useToast();

  const archiveWorkspaceRecord = useCallback(async () => {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
      return;
    }
    onSetHiding?.(true);
    onArchiveStarted();
    try {
      try {
        await archiveWorkspaceOptimistically({
          client,
          workspace: {
            serverId,
            workspaceId,
          },
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("sidebar.workspace.toasts.archiveFailed"),
        );
        return;
      }
      purgeArchivedWorkspaceState({ serverId, workspaceId });
      onArchiveSucceeded?.();
    } finally {
      onSetHiding?.(false);
    }
  }, [onArchiveStarted, onArchiveSucceeded, onSetHiding, serverId, t, toast, workspaceId]);

  const archive = useCallback(() => {
    void (async () => {
      const riskMessage =
        workspaceKind === "worktree"
          ? buildWorktreeArchiveConfirmationMessage(
              {
                workspaceName: name,
                isDirty,
                aheadOfOrigin,
                diffStat,
              },
              warningLabels,
            )
          : null;
      const confirmationMessage =
        riskMessage ??
        (confirmationPolicy === "always"
          ? t("sidebar.workspace.confirmations.archiveMessage")
          : null);
      if (confirmationMessage) {
        const confirmed = await confirmDialog({
          title: warningLabels.title(name),
          message: confirmationMessage,
          confirmLabel: warningLabels.confirm,
          cancelLabel: warningLabels.cancel,
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
      }
      await archiveWorkspaceRecord();
    })();
  }, [
    aheadOfOrigin,
    archiveWorkspaceRecord,
    confirmationPolicy,
    diffStat,
    isDirty,
    name,
    t,
    warningLabels,
    workspaceKind,
  ]);

  return {
    archive,
  };
}
