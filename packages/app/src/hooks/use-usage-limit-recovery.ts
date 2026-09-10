import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { AGENT_CONTINUE_PROMPT } from "@getpaseo/protocol/agent-continuation";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import {
  selectAgentTurnPresentation,
  useSessionStore,
  type SessionState,
} from "@/stores/session-store";
import { isLatestConversationMessageCodexUsageLimit } from "@/utils/codex-usage-limit-recovery";

interface UsageLimitRecoveryTarget {
  serverId: string;
  agentId: string;
}

interface UsageLimitRecoveryActivityState {
  inFlightCount: number;
  begin: (count: number) => boolean;
  finish: () => void;
}

const useUsageLimitRecoveryActivityStore = create<UsageLimitRecoveryActivityState>()(
  (set, get) => ({
    inFlightCount: 0,
    begin: (count) => {
      if (get().inFlightCount > 0) return false;
      set({ inFlightCount: count });
      return true;
    },
    finish: () => set({ inFlightCount: 0 }),
  }),
);

function isUsageLimitRecoveryCandidate(
  workspace: SidebarWorkspaceEntry,
  session: SessionState | undefined,
): workspace is SidebarWorkspaceEntry & { agentId: string } {
  if (!workspace.agentId || !session) return false;
  return isLatestConversationMessageCodexUsageLimit({
    tail: session.agentStreamTail.get(workspace.agentId) ?? [],
    head: session.agentStreamHead.get(workspace.agentId) ?? [],
  });
}

function collectUsageLimitRecoveryTargets(
  workspaces: readonly SidebarWorkspaceEntry[],
  sessions: Readonly<Record<string, SessionState>>,
): UsageLimitRecoveryTarget[] {
  const seenAgents = new Set<string>();
  const targets: UsageLimitRecoveryTarget[] = [];

  for (const workspace of workspaces) {
    if (!isUsageLimitRecoveryCandidate(workspace, sessions[workspace.serverId])) continue;
    const targetKey = `${workspace.serverId}:${workspace.agentId}`;
    if (seenAgents.has(targetKey)) continue;
    seenAgents.add(targetKey);
    targets.push({ serverId: workspace.serverId, agentId: workspace.agentId });
  }

  return targets;
}

function hasAgentPendingPermission(session: SessionState, agentId: string): boolean {
  for (const permission of session.pendingPermissions.values()) {
    if (permission.agentId === agentId) return true;
  }
  return false;
}

function encodeNoRecoveryImages(): Promise<Array<{ data: string; mimeType: string }>> {
  return Promise.resolve([]);
}

export function useUsageLimitRecovery(workspaces: readonly SidebarWorkspaceEntry[]) {
  const { t } = useTranslation();
  const toast = useToast();
  const candidateCount = useSessionStore(
    (state) => collectUsageLimitRecoveryTargets(workspaces, state.sessions).length,
  );
  const inFlightCount = useUsageLimitRecoveryActivityStore((state) => state.inFlightCount);
  const begin = useUsageLimitRecoveryActivityStore((state) => state.begin);
  const finish = useUsageLimitRecoveryActivityStore((state) => state.finish);
  const isRecovering = inFlightCount > 0;

  const continueUsageLimitedSessions = useCallback(() => {
    const targets = collectUsageLimitRecoveryTargets(
      workspaces,
      useSessionStore.getState().sessions,
    );
    if (targets.length === 0 || !begin(targets.length)) return;

    void Promise.all(
      targets.map(async ({ serverId, agentId }): Promise<"sent" | "skipped" | "failed"> => {
        const currentSession = useSessionStore.getState().sessions[serverId];
        if (!currentSession) return "skipped";
        const currentWorkspace = workspaces.find(
          (workspace) => workspace.serverId === serverId && workspace.agentId === agentId,
        );
        if (
          !currentWorkspace ||
          !isUsageLimitRecoveryCandidate(currentWorkspace, currentSession) ||
          selectAgentTurnPresentation(currentSession, agentId).isActive ||
          hasAgentPendingPermission(currentSession, agentId)
        ) {
          return "skipped";
        }

        const runtimeSnapshot = getHostRuntimeStore().getSnapshot(serverId);
        if (!runtimeSnapshot?.client || !isHostRuntimeConnected(runtimeSnapshot)) return "skipped";

        try {
          await dispatchComposerAgentMessage({
            client: runtimeSnapshot.client,
            agentId,
            text: AGENT_CONTINUE_PROMPT,
            attachments: [],
            encodeImages: encodeNoRecoveryImages,
            submission: createMessageSubmissionWriter(serverId),
          });
          return "sent";
        } catch (error: unknown) {
          console.error("Failed to continue usage-limited Codex session", {
            serverId,
            agentId,
            error,
          });
          return "failed";
        }
      }),
    )
      .then((results) => {
        const sent = results.filter((result) => result === "sent").length;
        const skipped = results.filter((result) => result === "skipped").length;
        const failed = results.filter((result) => result === "failed").length;
        if (skipped === 0 && failed === 0) {
          toast.show(t("cockpit.notifications.usageLimitRecoverySuccess", { count: sent }), {
            variant: "success",
          });
          return;
        }
        toast.show(
          t("cockpit.notifications.usageLimitRecoveryPartial", { sent, skipped, failed }),
          { variant: failed > 0 ? "error" : "warning", durationMs: 4_000 },
        );
        return;
      })
      .finally(finish);
  }, [begin, finish, t, toast, workspaces]);

  return {
    continueUsageLimitedSessions,
    isRecovering,
    usageLimitRecoveryCount: isRecovering ? inFlightCount : candidateCount,
  };
}
