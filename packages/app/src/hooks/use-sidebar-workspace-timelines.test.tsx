/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewedTimelineUiBridge } from "@/timeline/viewed-timeline-sync";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarWorkspaceTimelines } from "./use-sidebar-workspace-timelines";

interface PreviewWorkspace {
  serverId: string;
  agentId: string | null;
}

function createTimelineBridge() {
  const replaceVisibleAgentIds = vi.fn<(sourceId: string, agentIds: string[]) => void>();
  const bridge: ViewedTimelineUiBridge = {
    replaceVisibleAgentIds,
    subscribe: () => () => undefined,
    getAgentTimelineStatus: () => "ready",
    getAgentTimelineError: () => null,
    retryVisibleAgentTimeline: () => undefined,
    reprojectVisibleTimelines: () => undefined,
  };
  return { bridge, replaceVisibleAgentIds };
}

function workspaceMap(entries: Array<[string, string | null]>): Map<string, PreviewWorkspace> {
  return new Map(
    entries.map(([workspaceId, agentId]) => [workspaceId, { serverId: "srv", agentId }]),
  );
}

afterEach(() => {
  act(() => useSessionStore.getState().clearSession("srv"));
});

describe("useSidebarWorkspaceTimelines", () => {
  it("registers every root agent and updates membership without clearing the source", () => {
    const timeline = createTimelineBridge();
    act(() => {
      useSessionStore.getState().initializeSession("srv", null);
      useSessionStore.getState().setViewedTimelineSync("srv", timeline.bridge);
    });

    const { rerender, unmount } = renderHook(
      ({ workspaces, active }) => useSidebarWorkspaceTimelines(workspaces, active),
      {
        initialProps: {
          workspaces: workspaceMap([
            ["one", "agent-b"],
            ["two", "agent-a"],
            ["three", null],
          ]),
          active: true,
        },
      },
    );

    const sourceId = timeline.replaceVisibleAgentIds.mock.calls[0]?.[0];
    expect(sourceId).toBeTruthy();
    expect(timeline.replaceVisibleAgentIds).toHaveBeenLastCalledWith(sourceId, [
      "agent-a",
      "agent-b",
    ]);

    rerender({
      workspaces: workspaceMap([
        ["two", "agent-a"],
        ["four", "agent-c"],
      ]),
      active: true,
    });

    expect(timeline.replaceVisibleAgentIds.mock.calls).toEqual([
      [sourceId, ["agent-a", "agent-b"]],
      [sourceId, ["agent-a", "agent-c"]],
    ]);

    unmount();
    expect(timeline.replaceVisibleAgentIds).toHaveBeenLastCalledWith(sourceId, []);
  });

  it("releases membership while its sidebar model is inactive", () => {
    const timeline = createTimelineBridge();
    act(() => {
      useSessionStore.getState().initializeSession("srv", null);
      useSessionStore.getState().setViewedTimelineSync("srv", timeline.bridge);
    });

    const { rerender } = renderHook(
      ({ active }) => useSidebarWorkspaceTimelines(workspaceMap([["one", "agent-a"]]), active),
      { initialProps: { active: true } },
    );
    const sourceId = timeline.replaceVisibleAgentIds.mock.calls[0]?.[0];

    rerender({ active: false });

    expect(timeline.replaceVisibleAgentIds).toHaveBeenLastCalledWith(sourceId, []);
  });
});
