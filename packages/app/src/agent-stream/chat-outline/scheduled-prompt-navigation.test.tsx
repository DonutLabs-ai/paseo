// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentTimelineNavigationStore } from "@/stores/agent-timeline-navigation-store";
import { createActivePromptPublisher } from "./model";
import type { ChatOutline } from "./use-chat-outline";
import { useScheduledPromptNavigation } from "./scheduled-prompt-navigation";

function createChatOutline(overrides: Partial<ChatOutline>): ChatOutline {
  return {
    prompts: [],
    isLoaded: false,
    hasLoadError: false,
    activePrompt: createActivePromptPublisher(),
    jumpToPrompt: vi.fn(),
    reportReadingPosition: vi.fn(),
    ...overrides,
  };
}

describe("useScheduledPromptNavigation", () => {
  beforeEach(() => {
    useAgentTimelineNavigationStore.setState({ request: null });
  });

  it("jumps to the matching prompt and consumes the request", async () => {
    useAgentTimelineNavigationStore.getState().requestPrompt({
      serverId: "server-1",
      agentId: "agent-1",
      target: {
        scheduleId: "schedule-1",
        candidates: [{ scheduleRunId: "run-1" }],
      },
    });
    const request = useAgentTimelineNavigationStore.getState().request;
    const jumpToPrompt = vi.fn();
    const chatOutline = createChatOutline({
      isLoaded: true,
      jumpToPrompt,
      prompts: [
        {
          seq: 9,
          timestamp: "2026-09-04T00:00:00.000Z",
          preview: "scheduled prompt",
          scheduleId: "schedule-1",
          scheduleRunId: "run-1",
        },
      ],
    });

    renderHook(() =>
      useScheduledPromptNavigation({
        request,
        chatOutline,
        onPromptUnavailable: vi.fn(),
      }),
    );

    await waitFor(() => expect(jumpToPrompt).toHaveBeenCalledWith(9));
    expect(useAgentTimelineNavigationStore.getState().request).toBeNull();
  });

  it("reports an index load failure and consumes the request", async () => {
    useAgentTimelineNavigationStore.getState().requestPrompt({
      serverId: "server-1",
      agentId: "agent-1",
      target: {
        scheduleId: "schedule-1",
        candidates: [{ scheduleRunId: "run-1" }],
      },
    });
    const request = useAgentTimelineNavigationStore.getState().request;
    const onPromptUnavailable = vi.fn();

    renderHook(() =>
      useScheduledPromptNavigation({
        request,
        chatOutline: createChatOutline({ hasLoadError: true }),
        onPromptUnavailable,
      }),
    );

    await waitFor(() => expect(onPromptUnavailable).toHaveBeenCalledOnce());
    expect(useAgentTimelineNavigationStore.getState().request).toBeNull();
  });
});
