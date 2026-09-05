import type { AgentTimelinePromptTarget } from "@/stores/agent-timeline-navigation-store";
import type { ScheduleRun, StoredSchedule } from "@getpaseo/protocol/schedule/types";

export interface ScheduleSessionDestination {
  agentId: string;
  timelinePrompt?: AgentTimelinePromptTarget;
}

function promptCandidate(run: ScheduleRun): AgentTimelinePromptTarget["candidates"][number] {
  return run.promptMessageId
    ? { scheduleRunId: run.id, messageId: run.promptMessageId }
    : { scheduleRunId: run.id };
}

/**
 * Resolve the session owned by a schedule run. Existing-agent schedules keep
 * one stable target and can fall back through older runs. New-agent schedules
 * create a different session per run, so only the newest run with an agent is
 * a valid destination.
 */
export function resolveScheduleSessionDestination(
  schedule: StoredSchedule,
): ScheduleSessionDestination | null {
  if (schedule.target.type === "agent") {
    const candidates = schedule.runs
      .toReversed()
      .filter((run) => run.status !== "running")
      .map(promptCandidate);
    return {
      agentId: schedule.target.agentId,
      ...(candidates.length > 0 ? { timelinePrompt: { scheduleId: schedule.id, candidates } } : {}),
    };
  }

  const latestRunWithAgent = schedule.runs.toReversed().find((run) => run.agentId !== null);
  if (!latestRunWithAgent?.agentId) {
    return null;
  }
  return {
    agentId: latestRunWithAgent.agentId,
    timelinePrompt: {
      scheduleId: schedule.id,
      candidates: [promptCandidate(latestRunWithAgent)],
    },
  };
}
