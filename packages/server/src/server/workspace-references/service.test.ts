import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManager } from "../agent/agent-manager.js";
import { WorkspaceIntegrationCredentialStore } from "./credential-store.js";
import { WorkspaceReferenceService } from "./service.js";

const homes: string[] = [];

function referenceKeys(snapshot: { references: Array<{ key: string }> }): string[] {
  return snapshot.references.map((reference) => reference.key);
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("WorkspaceReferenceService", () => {
  it("refreshes only old-format Slack summaries when an unchanged workspace is opened", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workspace-references-"));
    homes.push(paseoHome);
    const workspaceId = "wks_reference_slack_format_test";
    const credentials = new WorkspaceIntegrationCredentialStore(paseoHome);
    credentials.set("slack", {
      token: "xoxb-test-token",
      accountLabel: "Test Slack",
      verifiedAt: "2026-09-22T00:00:00.000Z",
    });
    const digest = createHash("sha256").update(workspaceId).digest("hex");
    const referenceRoot = path.join(paseoHome, "workspace-references");
    mkdirSync(referenceRoot, { recursive: true });
    writeFileSync(
      path.join(referenceRoot, `${digest}.json`),
      `${JSON.stringify({
        version: 3,
        workspaceId,
        credentialRevisions: {
          linear: null,
          slack: credentials.revision("slack"),
        },
        agents: {
          "agent-1": {
            epoch: "epoch-1",
            lastSeq: 1,
            referenceKeys: ["linear:ENG-42", "slack:acme:C1:1700000000.000001"],
          },
        },
        targets: {
          "linear:ENG-42": {
            key: "linear:ENG-42",
            provider: "linear",
            url: "https://linear.app/acme/issue/ENG-42",
            identifier: "ENG-42",
          },
          "slack:acme:C1:1700000000.000001": {
            key: "slack:acme:C1:1700000000.000001",
            provider: "slack",
            url: "https://acme.slack.com/archives/C1/p1700000000000001",
            identifier: "C1:1700000000.000001",
            channelId: "C1",
            threadTs: "1700000000.000001",
          },
        },
        references: [
          {
            key: "linear:ENG-42",
            provider: "linear",
            url: "https://linear.app/acme/issue/ENG-42",
            title: "Linear issue",
            summary: "Keep the cached issue",
            state: "ready",
            error: null,
            fetchedAt: "2026-09-22T00:00:00.000Z",
          },
          {
            key: "slack:acme:C1:1700000000.000001",
            provider: "slack",
            url: "https://acme.slack.com/archives/C1/p1700000000000001",
            title: "Root request",
            summary: "OP — Person:\nRoot request\n\nRecent reply 1 — Person:\nReply",
            state: "ready",
            error: null,
            fetchedAt: "2026-09-22T00:00:00.000Z",
          },
        ],
        scannedAt: "2026-09-22T00:00:01.000Z",
      })}\n`,
    );
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/users.info")) {
        return new Response(
          JSON.stringify({
            ok: true,
            user: { id: "U1", profile: { display_name: "Person" } },
          }),
          { status: 200 },
        );
      }
      if (url.pathname.endsWith("/conversations.replies")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              { ts: "1700000000.000001", text: "Root request", user: "U1" },
              { ts: "1700000001.000001", text: "Reply", user: "U1" },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const logger = pino({ enabled: false });
    const service = new WorkspaceReferenceService({
      paseoHome,
      agentManager: {
        listAgents: () => [{ id: "agent-1", workspaceId }],
        fetchTimeline: () => ({
          epoch: "epoch-1",
          reset: false,
          window: { maxSeq: 1 },
          rows: [],
        }),
        getTimelineRows: async () => {
          throw new Error("unchanged timeline must not be rescanned");
        },
      },
      workspaceRegistry: {
        get: async () => ({
          workspaceId,
          projectId: "/tmp/project",
          cwd: "/tmp/project",
          kind: "directory",
          displayName: "project",
          title: null,
          branch: null,
          worktreeRoot: null,
          baseBranch: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
          createdAt: "2026-09-22T00:00:00.000Z",
          updatedAt: "2026-09-22T00:00:00.000Z",
          archivedAt: null,
          autoArchivedChangeRequestUrl: null,
          pinnedAt: null,
        }),
      },
      logger,
    });

    const result = await service.get(workspaceId);
    expect(
      result.references.find((reference) => reference.provider === "slack")?.summary,
    ).toContain("\n\n---\n\nRecent reply 1");
    expect(result.references.find((reference) => reference.provider === "linear")?.summary).toBe(
      "Keep the cached issue",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repeated = await service.get(workspaceId);
    expect(repeated.references).toEqual(result.references);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates persisted references by canonical key", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workspace-references-"));
    homes.push(paseoHome);
    const workspaceId = "wks_reference_dedupe_test";
    const digest = createHash("sha256").update(workspaceId).digest("hex");
    const referenceRoot = path.join(paseoHome, "workspace-references");
    mkdirSync(referenceRoot, { recursive: true });
    writeFileSync(
      path.join(referenceRoot, `${digest}.json`),
      `${JSON.stringify({
        version: 3,
        workspaceId,
        credentialRevisions: { linear: null, slack: null },
        agents: {},
        targets: {},
        references: [
          {
            key: "linear:ENG-42",
            provider: "linear",
            url: "https://linear.app/acme/issue/ENG-42",
            title: "stale title",
            summary: "stale excerpt",
            state: "ready",
            error: null,
            fetchedAt: "2026-09-22T00:00:00.000Z",
          },
          {
            key: "linear:ENG-42",
            provider: "linear",
            url: "https://linear.app/acme/issue/ENG-42",
            title: "current title",
            summary: "current excerpt",
            state: "ready",
            error: null,
            fetchedAt: "2026-09-22T00:01:00.000Z",
          },
        ],
        scannedAt: "2026-09-22T00:01:00.000Z",
      })}\n`,
    );

    const logger = pino({ enabled: false });
    const service = new WorkspaceReferenceService({
      paseoHome,
      agentManager: new AgentManager({ clients: {}, logger }),
      workspaceRegistry: {
        get: async () => {
          throw new Error("unchanged state must not start another scan");
        },
      },
      logger,
    });

    await expect(service.get(workspaceId)).resolves.toMatchObject({
      references: [{ key: "linear:ENG-42", title: "current title" }],
    });
  });

  it("publishes deduplicated progress after each fetched reference", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workspace-references-"));
    homes.push(paseoHome);
    const workspaceId = "wks_reference_progress_test";
    const logger = pino({ enabled: false });
    const timestamp = "2026-09-22T00:00:00.000Z";
    const service = new WorkspaceReferenceService({
      paseoHome,
      agentManager: {
        listAgents: () => [{ id: "agent-1", workspaceId }],
        fetchTimeline: () => ({
          epoch: "epoch-1",
          reset: false,
          window: { maxSeq: 1 },
          rows: [],
        }),
        getTimelineRows: async () => [
          {
            item: {
              type: "user_message",
              text: [
                "https://linear.app/acme/issue/ENG-42/first",
                "https://linear.app/acme/issue/eng-42/duplicate",
                "https://linear.app/acme/issue/ENG-43/second",
              ].join(" "),
            },
          },
        ],
      },
      workspaceRegistry: {
        get: async () => ({
          workspaceId,
          projectId: "/tmp/project",
          cwd: "/tmp/project",
          kind: "directory",
          displayName: "project",
          title: null,
          branch: null,
          worktreeRoot: null,
          baseBranch: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          archivedAt: null,
          autoArchivedChangeRequestUrl: null,
          pinnedAt: null,
        }),
      },
      logger,
    });
    const progress: Array<{ keys: string[]; scannedAt: string | null }> = [];

    const result = await service.get(workspaceId, (next) => {
      progress.push({
        keys: referenceKeys(next),
        scannedAt: next.scannedAt,
      });
    });

    expect(progress).toEqual([
      { keys: [], scannedAt: null },
      { keys: ["linear:ENG-42"], scannedAt: null },
      { keys: ["linear:ENG-42", "linear:ENG-43"], scannedAt: null },
    ]);
    expect(referenceKeys(result)).toEqual(["linear:ENG-42", "linear:ENG-43"]);
    expect(result.scannedAt).not.toBeNull();
  });

  it("does not automatically retry persisted errors when the timeline is unchanged", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workspace-references-"));
    homes.push(paseoHome);
    const workspaceId = "wks_reference_retry_test";
    const credentials = new WorkspaceIntegrationCredentialStore(paseoHome);
    credentials.set("linear", {
      token: "linear-secret",
      accountLabel: "Linear User",
      verifiedAt: "2026-09-22T00:00:00.000Z",
    });
    const revision = credentials.revision("linear");
    expect(revision).not.toBeNull();

    const digest = createHash("sha256").update(workspaceId).digest("hex");
    const referenceRoot = path.join(paseoHome, "workspace-references");
    mkdirSync(referenceRoot, { recursive: true });
    writeFileSync(
      path.join(referenceRoot, `${digest}.json`),
      `${JSON.stringify({
        version: 3,
        workspaceId,
        credentialRevisions: { linear: revision, slack: null },
        agents: {},
        targets: {
          "linear:ENG-42": {
            key: "linear:ENG-42",
            provider: "linear",
            url: "https://linear.app/acme/issue/ENG-42",
            identifier: "ENG-42",
          },
        },
        references: [
          {
            key: "linear:ENG-42",
            provider: "linear",
            url: "https://linear.app/acme/issue/ENG-42",
            title: "ENG-42 Example",
            summary: null,
            state: "error",
            error: "Previous source fetch failed",
            fetchedAt: null,
          },
        ],
        scannedAt: "2026-09-22T00:00:01.000Z",
      })}\n`,
    );

    const logger = pino({ enabled: false });
    const workspaceGet = vi.fn(async () => {
      throw new Error("unchanged state must not start another scan");
    });
    const service = new WorkspaceReferenceService({
      paseoHome,
      agentManager: new AgentManager({ clients: {}, logger }),
      workspaceRegistry: { get: workspaceGet },
      logger,
    });

    await expect(service.get(workspaceId)).resolves.toMatchObject({
      workspaceId,
      scannedAt: "2026-09-22T00:00:01.000Z",
      references: [{ key: "linear:ENG-42", state: "error" }],
    });
    expect(workspaceGet).not.toHaveBeenCalled();
  });

  it("rebuilds version 2 indexes with user-only discovery semantics", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workspace-references-"));
    homes.push(paseoHome);
    const workspaceId = "wks_reference_v2_test";
    const digest = createHash("sha256").update(workspaceId).digest("hex");
    const referenceRoot = path.join(paseoHome, "workspace-references");
    const statePath = path.join(referenceRoot, `${digest}.json`);
    mkdirSync(referenceRoot, { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify({
        version: 2,
        workspaceId,
        credentialRevisions: { linear: null, slack: null },
        agents: {},
        targets: {
          "linear:ENG-999": {
            key: "linear:ENG-999",
            provider: "linear",
            url: "https://linear.app/acme/issue/ENG-999",
            identifier: "ENG-999",
          },
        },
        references: [],
        scannedAt: "2026-09-22T00:00:01.000Z",
      })}\n`,
    );

    const logger = pino({ enabled: false });
    const timestamp = "2026-09-22T00:00:00.000Z";
    const service = new WorkspaceReferenceService({
      paseoHome,
      agentManager: new AgentManager({ clients: {}, logger }),
      workspaceRegistry: {
        get: async () => ({
          workspaceId,
          projectId: "/tmp/project",
          cwd: "/tmp/project",
          kind: "directory",
          displayName: "project",
          title: null,
          branch: null,
          worktreeRoot: null,
          baseBranch: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          archivedAt: null,
          autoArchivedChangeRequestUrl: null,
          pinnedAt: null,
        }),
      },
      logger,
    });

    await expect(service.get(workspaceId)).resolves.toMatchObject({
      workspaceId,
      references: [],
    });
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({
      version: 3,
      workspaceId,
      targets: {},
    });
  });
});
