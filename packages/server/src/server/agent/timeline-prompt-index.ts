import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

const PROMPT_PREVIEW_MAX_LENGTH = 120;

export interface TimelinePromptIndexEntry {
  seq: number;
  timestamp: string;
  preview: string;
  messageId?: string;
  scheduleId?: string;
  scheduleRunId?: string;
}

export interface TimelinePromptIndex {
  epoch: string;
  prompts: TimelinePromptIndexEntry[];
}

function promptPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PROMPT_PREVIEW_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, PROMPT_PREVIEW_MAX_LENGTH - 1)}…`;
}

export function buildTimelinePromptIndex(
  epoch: string,
  rows: readonly AgentTimelineRow[],
): TimelinePromptIndex {
  return {
    epoch,
    prompts: rows.flatMap((row) =>
      row.item.type === "user_message"
        ? [
            {
              seq: row.seq,
              timestamp: row.timestamp,
              preview: promptPreview(row.item.text),
              ...(row.item.clientMessageId || row.item.messageId
                ? { messageId: row.item.clientMessageId ?? row.item.messageId }
                : {}),
              ...(row.item.scheduleId ? { scheduleId: row.item.scheduleId } : {}),
              ...(row.item.scheduleRunId ? { scheduleRunId: row.item.scheduleRunId } : {}),
            },
          ]
        : [],
    ),
  };
}
