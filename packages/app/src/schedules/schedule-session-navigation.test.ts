import { describe, expect, it } from "vitest";
import type { StoredSchedule } from "@getpaseo/protocol/schedule/types";
import { resolveScheduleSessionDestination } from "./schedule-session-navigation";

const BASE_SCHEDULE: Omit<StoredSchedule, "target" | "runs"> = {
  id: "schedule-1",
  name: "closeout",
  prompt: "Check the rollout",
  cadence: { type: "cron", expression: "0 9 * * *" },
  status: "completed",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: "2026-09-05T00:00:00.000Z",
  pausedAt: null,
  expiresAt: null,
  maxRuns: 1,
};

describe("resolveScheduleSessionDestination", () => {
  it("opens the latest session created by a new-agent schedule", () => {
    const schedule: StoredSchedule = {
      ...BASE_SCHEDULE,
      target: { type: "new-agent", config: { provider: "codex", cwd: "/tmp/project" } },
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-09-04T00:00:00.000Z",
          startedAt: "2026-09-04T00:00:00.000Z",
          endedAt: "2026-09-04T00:01:00.000Z",
          status: "succeeded",
          agentId: "11111111-1111-4111-8111-111111111111",
          workspaceId: "workspace-1",
          promptMessageId: "prompt-1",
          output: "done",
          error: null,
        },
        {
          id: "run-2",
          scheduledFor: "2026-09-05T00:00:00.000Z",
          startedAt: "2026-09-05T00:00:00.000Z",
          endedAt: "2026-09-05T00:01:00.000Z",
          status: "succeeded",
          agentId: "22222222-2222-4222-8222-222222222222",
          workspaceId: "workspace-2",
          promptMessageId: "prompt-2",
          output: "done",
          error: null,
        },
      ],
    };

    expect(resolveScheduleSessionDestination(schedule)).toEqual({
      agentId: "22222222-2222-4222-8222-222222222222",
      timelinePrompt: {
        scheduleId: "schedule-1",
        candidates: [{ scheduleRunId: "run-2", messageId: "prompt-2" }],
      },
    });
  });

  it("returns no destination when a new-agent run failed before creating an agent", () => {
    const schedule: StoredSchedule = {
      ...BASE_SCHEDULE,
      target: { type: "new-agent", config: { provider: "codex", cwd: "/tmp/project" } },
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-09-05T00:00:00.000Z",
          startedAt: "2026-09-05T00:00:00.000Z",
          endedAt: "2026-09-05T00:00:01.000Z",
          status: "failed",
          agentId: null,
          workspaceId: null,
          output: null,
          error: "cwd missing",
        },
      ],
    };

    expect(resolveScheduleSessionDestination(schedule)).toBeNull();
  });

  it("keeps completed-run fallbacks for an existing session", () => {
    const schedule: StoredSchedule = {
      ...BASE_SCHEDULE,
      target: { type: "agent", agentId: "33333333-3333-4333-8333-333333333333" },
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-09-04T00:00:00.000Z",
          startedAt: "2026-09-04T00:00:00.000Z",
          endedAt: "2026-09-04T00:01:00.000Z",
          status: "succeeded",
          agentId: "33333333-3333-4333-8333-333333333333",
          promptMessageId: "prompt-1",
          output: "done",
          error: null,
        },
        {
          id: "run-2",
          scheduledFor: "2026-09-05T00:00:00.000Z",
          startedAt: "2026-09-05T00:00:00.000Z",
          endedAt: "2026-09-05T00:01:00.000Z",
          status: "failed",
          agentId: "33333333-3333-4333-8333-333333333333",
          output: null,
          error: "provider failed",
        },
      ],
    };

    expect(resolveScheduleSessionDestination(schedule)).toEqual({
      agentId: "33333333-3333-4333-8333-333333333333",
      timelinePrompt: {
        scheduleId: "schedule-1",
        candidates: [{ scheduleRunId: "run-2" }, { scheduleRunId: "run-1", messageId: "prompt-1" }],
      },
    });
  });
});
