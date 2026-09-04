import { beforeEach, describe, expect, it } from "vitest";
import {
  findTimelinePromptForNavigation,
  useAgentTimelineNavigationStore,
} from "./agent-timeline-navigation-store";

describe("agent timeline navigation", () => {
  beforeEach(() => {
    useAgentTimelineNavigationStore.setState({ request: null });
  });

  it("keeps a request until the matching consumer handles it", () => {
    const store = useAgentTimelineNavigationStore.getState();
    store.requestPrompt({
      serverId: "server-1",
      agentId: "agent-1",
      target: {
        scheduleId: "schedule-1",
        candidates: [{ messageId: "message-1", scheduleRunId: "run-1" }],
      },
    });
    const request = useAgentTimelineNavigationStore.getState().request;
    expect(request).toMatchObject({
      serverId: "server-1",
      agentId: "agent-1",
      scheduleId: "schedule-1",
      candidates: [{ messageId: "message-1", scheduleRunId: "run-1" }],
    });

    useAgentTimelineNavigationStore.getState().consume((request?.id ?? 0) + 1);
    expect(useAgentTimelineNavigationStore.getState().request).toBe(request);

    useAgentTimelineNavigationStore.getState().consume(request?.id ?? 0);
    expect(useAgentTimelineNavigationStore.getState().request).toBeNull();
  });

  it("matches the persisted message id and falls back to legacy schedule run identity", () => {
    const prompts = [
      {
        seq: 3,
        timestamp: "2026-09-04T00:00:00.000Z",
        preview: "new",
        messageId: "message-1",
        scheduleRunId: "run-1",
      },
      {
        seq: 7,
        timestamp: "2026-09-04T01:00:00.000Z",
        preview: "legacy",
        scheduleId: "schedule-1",
        scheduleRunId: "run-legacy",
      },
    ];

    expect(
      findTimelinePromptForNavigation(prompts, {
        scheduleId: "schedule-1",
        candidates: [{ messageId: "message-1", scheduleRunId: "wrong-run" }],
      })?.seq,
    ).toBe(3);
    expect(
      findTimelinePromptForNavigation(prompts, {
        scheduleId: "schedule-1",
        candidates: [{ scheduleRunId: "run-legacy" }],
      })?.seq,
    ).toBe(7);
  });

  it("selects the newest candidate that was actually projected into the timeline", () => {
    const prompts = [
      {
        seq: 4,
        timestamp: "2026-09-04T00:00:00.000Z",
        preview: "older delivered run",
        scheduleId: "schedule-1",
        scheduleRunId: "run-delivered",
      },
    ];

    expect(
      findTimelinePromptForNavigation(prompts, {
        scheduleId: "schedule-1",
        candidates: [
          { messageId: "missing-message", scheduleRunId: "run-not-delivered" },
          { scheduleRunId: "run-delivered" },
        ],
      })?.seq,
    ).toBe(4);
    expect(
      findTimelinePromptForNavigation(prompts, {
        scheduleId: "another-schedule",
        candidates: [{ scheduleRunId: "run-delivered" }],
      }),
    ).toBeNull();
  });
});
