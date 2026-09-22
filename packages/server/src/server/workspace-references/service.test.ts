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

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("WorkspaceReferenceService", () => {
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
        version: 2,
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

  it("rebuilds version 1 indexes with the current discovery semantics", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workspace-references-"));
    homes.push(paseoHome);
    const workspaceId = "wks_reference_v1_test";
    const digest = createHash("sha256").update(workspaceId).digest("hex");
    const referenceRoot = path.join(paseoHome, "workspace-references");
    const statePath = path.join(referenceRoot, `${digest}.json`);
    mkdirSync(referenceRoot, { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify({
        version: 1,
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
      version: 2,
      workspaceId,
      targets: {},
    });
  });
});
