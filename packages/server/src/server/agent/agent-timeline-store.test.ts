import { describe, expect, it } from "vitest";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";

describe("InMemoryAgentTimelineStore", () => {
  it("compresses old rows while preserving timeline identity and provider metadata", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 5,
      rows: [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "old" },
        },
        {
          seq: 2,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: {
            type: "tool_call",
            callId: "removed-call",
            name: "shell",
            status: "completed",
            error: null,
            detail: { type: "shell", command: "pwd", output: "/old" },
            providerTag: "preserved",
          },
        },
        {
          seq: 3,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: {
            type: "tool_call",
            callId: "retained-call",
            name: "shell",
            status: "running",
            error: null,
            detail: { type: "shell", command: "ls" },
          },
        },
        {
          seq: 4,
          timestamp: "2026-01-01T00:00:03.000Z",
          item: { type: "assistant_message", text: "latest" },
        },
      ],
    });

    expect(store.retainTail("agent-1", 2)).toBe(2);
    const compacted = store.getResidency("agent-1");
    expect(compacted).toMatchObject({
      residentRowCount: 2,
      compressedRowCount: 2,
    });
    expect(compacted.compressedBytes).toBeGreaterThan(0);
    expect(store.getLastAssistantMessage("agent-1")).toBe("latest");
    expect(store.getResidency("agent-1").compressedRowCount).toBe(2);
    expect(
      store.append("agent-1", { type: "assistant_message", text: "after compaction" }).seq,
    ).toBe(5);
    expect(store.getResidency("agent-1")).toMatchObject({
      residentRowCount: 3,
      compressedRowCount: 2,
    });
    expect(store.retainTail("agent-1", 2)).toBe(1);
    expect(store.getResidency("agent-1")).toMatchObject({
      residentRowCount: 2,
      compressedRowCount: 3,
    });

    expect(store.fetch("agent-1", { limit: 0 })).toMatchObject({
      epoch: "epoch-1",
      window: { minSeq: 1, maxSeq: 5, nextSeq: 6 },
      rows: [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }, { seq: 5 }],
    });
    expect(store.fetch("agent-1", { limit: 0 }).rows[1]?.item).toMatchObject({
      providerTag: "preserved",
    });
    expect(store.getToolCallSeqBounds("agent-1", "removed-call")).toEqual({
      minSeq: 2,
      maxSeq: 2,
    });
    expect(store.getToolCallSeqBounds("agent-1", "retained-call")).toEqual({
      minSeq: 3,
      maxSeq: 3,
    });
  });

  it("restores compressed rows when the latest assistant message crosses the tail boundary", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      rows: [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "one" },
        },
        {
          seq: 2,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "two" },
        },
        {
          seq: 3,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "three" },
        },
      ],
    });
    store.retainTail("agent-1", 2);

    expect(store.getLastAssistantMessage("agent-1")).toBe("onetwothree");
    expect(store.getResidency("agent-1")).toMatchObject({
      residentRowCount: 3,
      compressedRowCount: 0,
    });
  });

  it("indexes tool lifecycle bounds by call id", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: {
            type: "tool_call",
            callId: "call-1",
            name: "shell",
            status: "running",
            error: null,
            detail: { type: "shell", command: "pwd" },
          },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: {
            type: "tool_call",
            callId: "call-1",
            name: "shell",
            status: "completed",
            error: null,
            detail: { type: "shell", command: "pwd", output: "/workspace" },
          },
        },
      ],
    });

    const appended = store.append("agent-1", {
      type: "tool_call",
      callId: "call-2",
      name: "shell",
      status: "running",
      error: null,
      detail: { type: "shell", command: "ls" },
    });

    expect(store.getToolCallSeqBounds("agent-1", "call-1")).toEqual({
      minSeq: 5,
      maxSeq: 7,
    });
    expect(appended.seq).toBe(8);
    expect(store.getToolCallSeqBounds("agent-1", "call-2")).toEqual({
      minSeq: 8,
      maxSeq: 8,
    });
  });

  it("clamps an overshooting before cursor into the bounded tail window", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "before",
      cursor: { epoch: "epoch-1", seq: 100 },
      limit: 2,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "before",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });

  it("returns a bounded reset window when an after cursor is behind retained history", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
      limit: 1,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "after",
      reset: true,
      staleCursor: false,
      gap: true,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });
});
