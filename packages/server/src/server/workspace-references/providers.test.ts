import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import {
  extractWorkspaceReferenceTargets,
  fetchLinearReference,
  fetchSlackReference,
  normalizeWorkspaceReferenceUrl,
} from "./providers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace reference URL discovery", () => {
  it("normalizes Linear issue URLs and drops the mutable slug", () => {
    expect(
      normalizeWorkspaceReferenceUrl(
        "https://linear.app/donutbrowser/issue/ENG-1234/some-title?utm_source=test",
      ),
    ).toEqual({
      provider: "linear",
      key: "linear:ENG-1234",
      identifier: "ENG-1234",
      url: "https://linear.app/donutbrowser/issue/ENG-1234",
    });
  });

  it("normalizes a Slack reply permalink to its thread root", () => {
    expect(
      normalizeWorkspaceReferenceUrl(
        "https://donutbrowser.slack.com/archives/C123/p1788497156299669?thread_ts=1788493233.086649&cid=C123",
      ),
    ).toEqual({
      provider: "slack",
      key: "slack:donutbrowser:C123:1788493233.086649",
      identifier: "C123:1788493233.086649",
      channelId: "C123",
      threadTs: "1788493233.086649",
      url: "https://donutbrowser.slack.com/archives/C123/p1788493233086649",
    });
  });

  it("finds and deduplicates references in user messages", () => {
    const targets = extractWorkspaceReferenceTargets({
      type: "user_message",
      text: [
        "See https://linear.app/donutbrowser/issue/ENG-9/example.",
        "https://linear.app/donutbrowser/issue/ENG-9/renamed",
        "https://acme.slack.com/archives/C1/p1700000000123456",
      ].join("\n"),
    });

    expect(targets.map((target) => target.key)).toEqual([
      "linear:ENG-9",
      "slack:acme:C1:1700000000.123456",
    ]);
  });

  it("ignores links in assistant messages, reasoning, tool calls, and tool output", () => {
    const incidentalUrl = "https://linear.app/donutbrowser/issue/ENG-999/incidental";
    const hiddenItems: AgentTimelineItem[] = [
      { type: "assistant_message", text: incidentalUrl },
      { type: "reasoning", text: incidentalUrl },
      {
        type: "tool_call",
        callId: "call-1",
        name: "Shell",
        detail: { type: "unknown", input: incidentalUrl, output: incidentalUrl },
        status: "completed",
        error: null,
      },
      { type: "error", message: incidentalUrl },
    ];

    expect(hiddenItems.flatMap(extractWorkspaceReferenceTargets)).toEqual([]);
  });
});

describe("workspace reference source boundaries", () => {
  it("uses only Linear issue fields and description", async () => {
    const requestSchema = z.object({ query: z.string(), variables: z.object({ id: z.string() }) });
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = requestSchema.parse(JSON.parse(String(init?.body)));
      expect(body.variables.id).toBe("ENG-42");
      expect(body.query).not.toContain("comments");
      expect(body.query).not.toContain("state");
      expect(body.query).not.toContain("url");
      return new Response(
        JSON.stringify({
          data: {
            issue: {
              identifier: "ENG-42",
              title: "Preserve retry status",
              description: [
                "The upstream 429 must remain retryable.",
                "Preserve the provider status.",
                "Keep the retry signal.",
                "This fourth paragraph is outside the excerpt.",
              ].join("\n\n"),
              url: "https://linear.app/acme/issue/ENG-42",
              state: { name: "In Progress" },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const source = await fetchLinearReference(
      {
        provider: "linear",
        key: "linear:ENG-42",
        identifier: "ENG-42",
        url: "https://linear.app/acme/issue/ENG-42",
      },
      "lin_api_token",
    );

    expect(source).toEqual({
      title: "ENG-42 Preserve retry status",
      excerpt: [
        "The upstream 429 must remain retryable.",
        "Preserve the provider status.",
        "Keep the retry signal.",
      ].join("\n\n"),
    });
  });

  it("renders the Slack OP and only the last five replies", async () => {
    const messages = [
      { ts: "1700000000.000001", text: "Root request", user: "U0" },
      ...Array.from({ length: 7 }, (_, index) => ({
        ts: `170000000${index + 1}.000001`,
        text: `Reply ${index + 1}`,
        user: `U${index + 1}`,
      })),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, messages }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const source = await fetchSlackReference(
      {
        provider: "slack",
        key: "slack:acme:C1:1700000000.000001",
        identifier: "C1:1700000000.000001",
        channelId: "C1",
        threadTs: "1700000000.000001",
        url: "https://acme.slack.com/archives/C1/p1700000000000001",
      },
      "xoxp-token",
    );

    expect(source.title).toBe("Root request");
    expect(source.excerpt).toContain("OP — U0:\nRoot request");
    expect(source.excerpt).not.toContain("Reply 1");
    expect(source.excerpt).not.toContain("Reply 2");
    for (const index of [3, 4, 5, 6, 7]) {
      expect(source.excerpt).toContain(`Reply ${index}`);
    }
    expect(source.excerpt.length).toBeLessThanOrEqual(800);
  });

  it("uses attachment and block content and decodes Slack mrkdwn entities", async () => {
    const messages = [
      {
        ts: "1700000000.000001",
        text: "",
        bot_profile: { name: "Turing" },
        attachments: [
          {
            title: "*Alert &amp; recovery*",
            text: [
              "&gt; investigate <@U123> with <https://example.com/runbook|the runbook>",
              "Mark :white_check_mark: when _ready_",
            ].join("\n"),
          },
        ],
      },
      {
        ts: "1700000001.000001",
        text: "",
        username: "Linear",
        blocks: [{ text: { type: "mrkdwn", text: "Issue &lt;ready&gt; for review" } }],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, messages }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const source = await fetchSlackReference(
      {
        provider: "slack",
        key: "slack:acme:C1:1700000000.000001",
        identifier: "C1:1700000000.000001",
        channelId: "C1",
        threadTs: "1700000000.000001",
        url: "https://acme.slack.com/archives/C1/p1700000000000001",
      },
      "xoxp-token",
    );

    expect(source.title).toBe("Alert & recovery");
    expect(source.excerpt).toContain(
      "OP — Turing:\nAlert & recovery\n> investigate @U123 with the runbook",
    );
    expect(source.excerpt).toContain("Mark :white_check_mark: when ready");
    expect(source.excerpt).toContain("Recent reply 1 — Linear:\nIssue <ready> for review");
    expect(source.excerpt).not.toContain("&amp;");
    expect(source.excerpt).not.toContain("*Alert");
    expect(source.excerpt).not.toContain("(empty message)");
  });
});
