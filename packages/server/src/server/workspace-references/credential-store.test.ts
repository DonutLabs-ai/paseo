import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_FILE_MODE } from "../private-files.js";
import { WorkspaceIntegrationCredentialStore } from "./credential-store.js";

const MODE_MASK = 0o777;

describe("WorkspaceIntegrationCredentialStore", () => {
  it("persists credentials privately and exposes status without the token", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-workspace-integrations-"));
    const filePath = path.join(home, "workspace-integrations", "credentials.json");
    try {
      const store = new WorkspaceIntegrationCredentialStore(home);
      const status = store.set("linear", {
        token: "lin_api_secret",
        accountLabel: "Paseo User",
        verifiedAt: "2026-09-22T00:00:00.000Z",
      });

      expect(status).toEqual({
        provider: "linear",
        configured: true,
        accountLabel: "Paseo User",
        verifiedAt: "2026-09-22T00:00:00.000Z",
      });
      expect(JSON.stringify(store.statuses())).not.toContain("lin_api_secret");
      expect(readFileSync(filePath, "utf8")).toContain("lin_api_secret");
      if (process.platform !== "win32") {
        expect(statSync(filePath).mode & MODE_MASK).toBe(PRIVATE_FILE_MODE);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("removes one provider without changing the other", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-workspace-integrations-"));
    try {
      const store = new WorkspaceIntegrationCredentialStore(home);
      store.set("linear", {
        token: "linear-secret",
        accountLabel: "Linear User",
        verifiedAt: "2026-09-22T00:00:00.000Z",
      });
      store.set("slack", {
        token: "slack-secret",
        accountLabel: "Slack Workspace",
        verifiedAt: "2026-09-22T00:00:01.000Z",
      });

      store.remove("linear");

      expect(store.get("linear")).toBeNull();
      expect(store.get("slack")?.token).toBe("slack-secret");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("changes the private revision when a credential is replaced", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-workspace-integrations-"));
    try {
      const store = new WorkspaceIntegrationCredentialStore(home);
      store.set("linear", {
        token: "first-secret",
        accountLabel: "Linear User",
        verifiedAt: "2026-09-22T00:00:00.000Z",
      });
      const firstRevision = store.revision("linear");

      store.set("linear", {
        token: "second-secret",
        accountLabel: "Linear User",
        verifiedAt: "2026-09-22T00:00:00.000Z",
      });

      const secondRevision = store.revision("linear");
      expect(firstRevision).not.toBeNull();
      expect(secondRevision).not.toBeNull();
      expect(secondRevision).not.toBe(firstRevision);
      expect(JSON.stringify(store.statuses())).not.toContain(secondRevision);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
