import { describe, expect, test } from "vitest";

import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  AGENT_TIMELINE_ITEM_MAX_BYTES,
  limitAgentTimelineItemContent,
} from "./agent-timeline-content.js";

describe("agent timeline content", () => {
  test("limits terminal input to the tool-call content budget", () => {
    const oversizedInput = "x".repeat(64 * 1024 + 1);

    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "terminal-session-4242",
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        text: oversizedInput,
        icon: "square_terminal",
      },
    });

    expect(item).toEqual({
      type: "tool_call",
      callId: "terminal-session-4242",
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        text: "x".repeat(64 * 1024),
        icon: "square_terminal",
      },
    });
  });

  test("preserves exact UTF-16 prefixes for every truncated tool-call field", () => {
    const exactPrefix = `${"x".repeat(64 * 1024 - 1)}\ud83d`;
    const oversizedText = `${exactPrefix}\ude00tail`;

    const plainText = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "plain-text",
      name: "plain_text",
      status: "completed",
      error: null,
      detail: { type: "plain_text", text: oversizedText },
    });
    const shellOutput = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "shell-output",
      name: "shell",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "synthetic", output: oversizedText },
    });
    const failedShell = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "failed-shell",
      name: "shell",
      status: "failed",
      error: { message: "failed", content: oversizedText },
      detail: { type: "shell", command: "synthetic" },
    });

    expect(plainText).toMatchObject({ detail: { text: exactPrefix } });
    expect(shellOutput).toMatchObject({ detail: { output: exactPrefix } });
    expect(failedShell).toMatchObject({ error: { content: exactPrefix } });
  });

  test("bounds every timeline item shape without changing its discriminant", () => {
    const oversizedText = "🦀".repeat(128 * 1024);
    const items: AgentTimelineItem[] = [
      {
        type: "user_message",
        text: oversizedText,
        messageId: "user-1",
        scheduleId: "schedule-1",
        scheduleRunId: "run-1",
      },
      { type: "assistant_message", text: oversizedText, messageId: "assistant-1" },
      { type: "reasoning", text: oversizedText },
      { type: "error", message: oversizedText },
      { type: "notification", level: "warning", message: oversizedText },
      { type: "todo", items: [{ id: "task-1", text: oversizedText, completed: false }] },
      {
        type: "tool_call",
        callId: "call-1",
        name: "read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath: "/tmp/example", content: oversizedText },
      },
      { type: "compaction", status: "completed", providerPayload: oversizedText },
      {
        type: "plugin",
        id: "plugin-item-1",
        pluginId: "example",
        kind: "result",
        version: 1,
        data: { content: oversizedText },
      },
    ];

    for (const item of items) {
      const limited = limitAgentTimelineItemContent(item);
      expect(limited.type).toBe(item.type);
      expect(Buffer.byteLength(JSON.stringify(limited), "utf8")).toBeLessThanOrEqual(
        AGENT_TIMELINE_ITEM_MAX_BYTES,
      );
    }
    expect(limitAgentTimelineItemContent(items[0])).toMatchObject({
      scheduleId: "schedule-1",
      scheduleRunId: "run-1",
    });
  });
});
