import { describe, expect, test } from "vitest";
import { InMemoryAgentTimelineStore } from "../agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
} from "../agent-timeline-store-types.js";
import { ProviderSubagentStore } from "./store.js";

class RecordingTimelineStore extends InMemoryAgentTimelineStore {
  readonly fetches: Array<{
    options: AgentTimelineFetchOptions | undefined;
    result: AgentTimelineFetchResult;
  }> = [];

  override fetch(agentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    const result = super.fetch(agentId, options);
    this.fetches.push({ options, result });
    return result;
  }
}

describe("ProviderSubagentStore", () => {
  test("keeps provider children and their timelines scoped to the parent agent", () => {
    const subagents = new ProviderSubagentStore();

    subagents.apply("parent-a", "codex", {
      type: "upsert",
      id: "child-1",
      title: "Explore",
      cwd: "/workspace/child",
      status: "running",
      timestamp: "2026-07-12T10:00:00.000Z",
    });
    subagents.apply("parent-a", "codex", {
      type: "timeline",
      id: "child-1",
      item: { type: "assistant_message", text: "Found it." },
      timestamp: "2026-07-12T10:00:01.000Z",
    });
    subagents.apply("parent-a", "codex", {
      type: "upsert",
      id: "child-1",
      status: "completed",
      timestamp: "2026-07-12T10:00:02.000Z",
    });
    subagents.apply("parent-b", "claude", {
      type: "upsert",
      id: "child-1",
      title: "Review",
      status: "running",
      timestamp: "2026-07-12T10:00:03.000Z",
    });

    expect(subagents.list("parent-a")).toEqual([
      expect.objectContaining({
        id: "child-1",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Explore",
        cwd: "/workspace/child",
        status: "completed",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:02.000Z",
      }),
    ]);
    expect(subagents.fetchTimeline("parent-a", "child-1").rows).toEqual([
      {
        seq: 1,
        timestamp: "2026-07-12T10:00:01.000Z",
        item: { type: "assistant_message", text: "Found it." },
      },
    ]);
    expect(subagents.list("parent-b")[0]).toMatchObject({ provider: "claude", title: "Review" });
    expect(subagents.deleteParent("parent-a")).toEqual([
      { type: "remove", parentAgentId: "parent-a", subagentId: "child-1" },
    ]);
    expect(subagents.list("parent-a")).toEqual([]);
    expect(subagents.list("parent-b")).toHaveLength(1);
  });

  test("limits oversized provider child tool output before storage", () => {
    const subagents = new ProviderSubagentStore();
    const output = "x".repeat(70 * 1024);
    const update = subagents.apply("parent-a", "opencode", {
      type: "timeline",
      id: "child-1",
      item: {
        type: "tool_call",
        callId: "call-1",
        name: "shell",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "print", output },
      },
    });

    expect(update.type).toBe("timeline");
    const [row] = subagents.fetchTimeline("parent-a", "child-1").rows;
    expect(row?.item).toMatchObject({
      type: "tool_call",
      detail: { type: "shell", output: "x".repeat(64 * 1024) },
    });
  });

  test("pages provider history on projected item boundaries", () => {
    const subagents = new ProviderSubagentStore();
    for (let index = 0; index < 101; index += 1) {
      subagents.apply("parent-a", "opencode", {
        type: "timeline",
        id: "child-1",
        item: { type: "assistant_message", text: String(index) },
      });
    }

    const page = subagents.fetchTimeline("parent-a", "child-1", {
      direction: "tail",
      limit: 1,
    });
    expect(page.rows).toHaveLength(101);
    expect(page.rows[0]?.seq).toBe(1);
    expect(page.rows.at(-1)?.seq).toBe(101);
    expect(page.hasOlder).toBe(false);
  });

  test("fetches a bounded canonical tail for nonmergeable provider history", () => {
    const timelines = new RecordingTimelineStore();
    const subagents = new ProviderSubagentStore(timelines);
    for (let index = 1; index <= 600; index += 1) {
      subagents.apply("parent-a", "opencode", {
        type: "timeline",
        id: "child-1",
        item: { type: "user_message", text: `message ${index}` },
      });
    }

    const page = subagents.fetchTimeline("parent-a", "child-1", {
      direction: "tail",
      limit: 100,
    });

    expect(page.rows.map((row) => row.seq)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 501),
    );
    expect(page.hasOlder).toBe(true);
    expect(
      timelines.fetches.map(({ options, result }) => ({
        direction: options?.direction,
        limit: options?.limit,
        rowCount: result.rows.length,
      })),
    ).toEqual([{ direction: "tail", limit: 100, rowCount: 100 }]);
  });

  test("expands a bounded fetch to include a projected tool lifecycle", () => {
    const timelines = new RecordingTimelineStore();
    const subagents = new ProviderSubagentStore(timelines);
    for (let index = 1; index <= 194; index += 1) {
      subagents.apply("parent-a", "opencode", {
        type: "timeline",
        id: "child-1",
        item: { type: "user_message", text: `message ${index}` },
      });
    }
    for (const status of ["running", "completed"] as const) {
      subagents.apply("parent-a", "opencode", {
        type: "timeline",
        id: "child-1",
        item: {
          type: "tool_call",
          callId: "call-1",
          name: "shell",
          status,
          error: null,
          detail: { type: "shell", command: "pwd", output: "/workspace" },
        },
      });
    }
    for (let index = 197; index <= 200; index += 1) {
      subagents.apply("parent-a", "opencode", {
        type: "timeline",
        id: "child-1",
        item: { type: "user_message", text: `message ${index}` },
      });
    }

    const page = subagents.fetchTimeline("parent-a", "child-1", {
      direction: "tail",
      limit: 10,
    });

    expect(page.rows.map((row) => row.seq)).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 190),
    );
    expect(
      timelines.fetches.map(({ options, result }) => ({
        direction: options?.direction,
        limit: options?.limit,
        rowCount: result.rows.length,
      })),
    ).toEqual([
      { direction: "tail", limit: 10, rowCount: 10 },
      { direction: "before", limit: 10, rowCount: 10 },
    ]);
  });
});
