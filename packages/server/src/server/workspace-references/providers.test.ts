import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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

  it("finds and deduplicates references inside nested timeline payloads", () => {
    const targets = extractWorkspaceReferenceTargets({
      user: "See https://linear.app/donutbrowser/issue/ENG-9/example.",
      assistant: [
        { text: "https://linear.app/donutbrowser/issue/ENG-9/renamed" },
        { text: "https://acme.slack.com/archives/C1/p1700000000123456" },
      ],
    });

    expect(targets.map((target) => target.key)).toEqual([
      "linear:ENG-9",
      "slack:acme:C1:1700000000.123456",
    ]);
  });
});

describe("workspace reference source boundaries", () => {
  it("uses only Linear issue fields and description", async () => {
    const requestSchema = z.object({ query: z.string(), variables: z.object({ id: z.string() }) });
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = requestSchema.parse(JSON.parse(String(init?.body)));
      expect(body.variables.id).toBe("ENG-42");
      expect(body.query).not.toContain("comments");
      return new Response(
        JSON.stringify({
          data: {
            issue: {
              identifier: "ENG-42",
              title: "Preserve retry status",
              description: "The upstream 429 must remain retryable.",
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
      content: "Status: In Progress\nDescription:\nThe upstream 429 must remain retryable.",
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
    expect(source.content).toContain("OP — U0:\nRoot request");
    expect(source.content).not.toContain("Reply 1");
    expect(source.content).not.toContain("Reply 2");
    for (const index of [3, 4, 5, 6, 7]) {
      expect(source.content).toContain(`Reply ${index}`);
    }
  });
});
