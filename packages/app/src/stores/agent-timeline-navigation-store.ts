import { create } from "zustand";
import type { AgentTimelinePromptIndexPayload } from "@getpaseo/client/internal/daemon-client";

export interface AgentTimelinePromptCandidate {
  messageId?: string;
  scheduleRunId: string;
}

export interface AgentTimelinePromptTarget {
  scheduleId: string;
  candidates: AgentTimelinePromptCandidate[];
}

export interface AgentTimelineNavigationRequest extends AgentTimelinePromptTarget {
  id: number;
  serverId: string;
  agentId: string;
}

interface AgentTimelineNavigationState {
  request: AgentTimelineNavigationRequest | null;
  requestPrompt: (input: {
    serverId: string;
    agentId: string;
    target: AgentTimelinePromptTarget;
  }) => void;
  consume: (requestId: number) => void;
}

let nextRequestId = 0;

export const useAgentTimelineNavigationStore = create<AgentTimelineNavigationState>()((set) => ({
  request: null,
  requestPrompt: (input) => {
    nextRequestId += 1;
    set({
      request: {
        id: nextRequestId,
        serverId: input.serverId,
        agentId: input.agentId,
        ...input.target,
      },
    });
  },
  consume: (requestId) => {
    set((state) => (state.request?.id === requestId ? { request: null } : state));
  },
}));

export function findTimelinePromptForNavigation(
  prompts: AgentTimelinePromptIndexPayload["prompts"],
  request: AgentTimelinePromptTarget,
): AgentTimelinePromptIndexPayload["prompts"][number] | null {
  for (const candidate of request.candidates) {
    const prompt = prompts.find(
      (entry) =>
        (candidate.messageId !== undefined && entry.messageId === candidate.messageId) ||
        (entry.scheduleId === request.scheduleId &&
          entry.scheduleRunId === candidate.scheduleRunId),
    );
    if (prompt) {
      return prompt;
    }
  }
  return null;
}
