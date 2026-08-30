import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { Agent } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

interface CockpitAgentSession {
  serverId: string;
  agents: ReadonlyMap<string, CockpitUsageAgent>;
}

interface CockpitUsageAgent {
  provider: Agent["provider"];
  lastUsage?: Agent["lastUsage"];
}

interface CockpitUsageWorkspace {
  workspaceKey: string;
  serverId: string;
  agentId: string | null;
}

export interface CockpitAgentUsage {
  provider: Agent["provider"];
  contextWindowMaxTokens: number | null;
  contextWindowUsedTokens: number | null;
  totalCostUsd: number | null;
}

const EMPTY_AGENT_SESSIONS: CockpitAgentSession[] = [];

function areAgentSessionsEqual(
  left: readonly CockpitAgentSession[],
  right: readonly CockpitAgentSession[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (session, index) =>
      session.serverId === right[index]?.serverId && session.agents === right[index]?.agents,
  );
}

export function buildCockpitAgentUsageByWorkspace(input: {
  workspaces: readonly CockpitUsageWorkspace[];
  sessions: readonly CockpitAgentSession[];
}): ReadonlyMap<string, CockpitAgentUsage> {
  const agentsByServerId = new Map(
    input.sessions.map((session) => [session.serverId, session.agents] as const),
  );
  const usageByWorkspace = new Map<string, CockpitAgentUsage>();

  for (const workspace of input.workspaces) {
    if (!workspace.agentId) continue;
    const agent = agentsByServerId.get(workspace.serverId)?.get(workspace.agentId);
    if (!agent) continue;
    usageByWorkspace.set(workspace.workspaceKey, {
      provider: agent.provider,
      contextWindowMaxTokens: agent.lastUsage?.contextWindowMaxTokens ?? null,
      contextWindowUsedTokens: agent.lastUsage?.contextWindowUsedTokens ?? null,
      totalCostUsd: agent.lastUsage?.totalCostUsd ?? null,
    });
  }

  return usageByWorkspace;
}

export function useCockpitAgentUsage(
  workspaces: readonly SidebarWorkspaceEntry[],
): ReadonlyMap<string, CockpitAgentUsage> {
  const serverIds = useMemo(
    () => [...new Set(workspaces.map((workspace) => workspace.serverId))],
    [workspaces],
  );
  const sessions = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (serverIds.length === 0) return EMPTY_AGENT_SESSIONS;
      return serverIds.flatMap((serverId) => {
        const agents = state.sessions[serverId]?.agents;
        return agents ? [{ serverId, agents }] : [];
      });
    },
    areAgentSessionsEqual,
  );

  return useMemo(
    () => buildCockpitAgentUsageByWorkspace({ workspaces, sessions }),
    [sessions, workspaces],
  );
}
