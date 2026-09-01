import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { ViewedTimelineUiBridge } from "@/timeline/viewed-timeline-sync";
import { useSessionStore } from "@/stores/session-store";

interface SidebarTimelineWorkspace {
  serverId: string;
  agentId: string | null;
}

interface SidebarTimelineSession {
  serverId: string;
  sync: ViewedTimelineUiBridge | null;
}

interface SidebarTimelineRegistration {
  sync: ViewedTimelineUiBridge;
  agentIds: string[];
}

const EMPTY_SESSIONS: SidebarTimelineSession[] = [];

function selectSidebarTimelineSessions(
  sessions: ReturnType<typeof useSessionStore.getState>["sessions"],
  serverIds: readonly string[],
): SidebarTimelineSession[] {
  if (serverIds.length === 0) return EMPTY_SESSIONS;
  return serverIds.map((serverId) => ({
    serverId,
    sync: sessions[serverId]?.viewedTimelineSync ?? null,
  }));
}

function areSidebarTimelineSessionsEqual(
  left: readonly SidebarTimelineSession[],
  right: readonly SidebarTimelineSession[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (session, index) =>
        session.serverId === right[index]?.serverId && session.sync === right[index]?.sync,
    )
  );
}

function sameAgentIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((agentId, index) => agentId === right[index]);
}

/**
 * Keeps the lightweight sidebar/cockpit previews in the daemon's selective timeline membership.
 * Workspace detail screens own their pane timelines separately; this source owns every root agent
 * represented by the active sidebar model so background replies continue to reach summary cards.
 */
export function useSidebarWorkspaceTimelines(
  workspaces: ReadonlyMap<string, SidebarTimelineWorkspace>,
  active: boolean,
): void {
  const reactId = useId();
  const sourceId = `sidebar-workspace-previews-${reactId}`;
  const serverIds = useMemo(() => {
    if (!active) return [];
    return [...new Set([...workspaces.values()].map((workspace) => workspace.serverId))].sort();
  }, [active, workspaces]);
  const sessions = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSidebarTimelineSessions(state.sessions, serverIds),
    areSidebarTimelineSessionsEqual,
  );
  const registrationsRef = useRef(new Map<string, SidebarTimelineRegistration>());

  const desiredRegistrations = useMemo(() => {
    const agentIdsByServer = new Map<string, Set<string>>();
    if (active) {
      for (const workspace of workspaces.values()) {
        if (!workspace.agentId) continue;
        const agentIds = agentIdsByServer.get(workspace.serverId) ?? new Set<string>();
        agentIds.add(workspace.agentId);
        agentIdsByServer.set(workspace.serverId, agentIds);
      }
    }

    const next = new Map<string, SidebarTimelineRegistration>();
    for (const session of sessions) {
      const agentIds = agentIdsByServer.get(session.serverId);
      if (!session.sync || !agentIds || agentIds.size === 0) continue;
      next.set(session.serverId, {
        sync: session.sync,
        agentIds: [...agentIds].sort(),
      });
    }
    return next;
  }, [active, sessions, workspaces]);

  useLayoutEffect(() => {
    const previous = registrationsRef.current;
    for (const [serverId, registration] of previous) {
      const desired = desiredRegistrations.get(serverId);
      if (!desired || desired.sync !== registration.sync) {
        registration.sync.replaceVisibleAgentIds(sourceId, []);
      }
    }
    for (const [serverId, desired] of desiredRegistrations) {
      const previousRegistration = previous.get(serverId);
      if (
        previousRegistration?.sync === desired.sync &&
        sameAgentIds(previousRegistration.agentIds, desired.agentIds)
      ) {
        continue;
      }
      desired.sync.replaceVisibleAgentIds(sourceId, desired.agentIds);
    }
    registrationsRef.current = desiredRegistrations;
  }, [desiredRegistrations, sourceId]);

  useLayoutEffect(
    () => () => {
      for (const registration of registrationsRef.current.values()) {
        registration.sync.replaceVisibleAgentIds(sourceId, []);
      }
      registrationsRef.current.clear();
    },
    [sourceId],
  );
}
