import { useEffect } from "react";
import {
  findTimelinePromptForNavigation,
  useAgentTimelineNavigationStore,
  type AgentTimelineNavigationRequest,
} from "@/stores/agent-timeline-navigation-store";
import type { ChatOutline } from "./use-chat-outline";

export function useScheduledPromptNavigationRequest(
  serverId: string,
  agentId: string,
): AgentTimelineNavigationRequest | null {
  const request = useAgentTimelineNavigationStore((state) => state.request);
  if (request?.serverId !== serverId || request.agentId !== agentId) {
    return null;
  }
  return request;
}

export function shouldLoadTimelinePromptIndex(
  supported: boolean,
  outlineEnabled: boolean,
  request: AgentTimelineNavigationRequest | null,
): boolean {
  return supported && (outlineEnabled || request !== null);
}

export function useScheduledPromptNavigation(input: {
  request: AgentTimelineNavigationRequest | null;
  chatOutline: ChatOutline;
  onPromptUnavailable: () => void;
}): void {
  const { request, chatOutline, onPromptUnavailable } = input;
  const { hasLoadError, isLoaded, jumpToPrompt, prompts } = chatOutline;

  useEffect(() => {
    if (!request) {
      return;
    }
    if (hasLoadError) {
      onPromptUnavailable();
      useAgentTimelineNavigationStore.getState().consume(request.id);
      return;
    }
    if (!isLoaded) {
      return;
    }
    const prompt = findTimelinePromptForNavigation(prompts, request);
    if (prompt) {
      jumpToPrompt(prompt.seq);
    } else {
      onPromptUnavailable();
    }
    useAgentTimelineNavigationStore.getState().consume(request.id);
  }, [hasLoadError, isLoaded, jumpToPrompt, onPromptUnavailable, prompts, request]);
}
