import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseImportTimeoutMs, resolveImportCwd, runImportCommand } from "./import.js";

const importAgent = vi.fn();
const close = vi.fn(async () => {});
const hostFeatures = vi.hoisted(() => ({ importSessionMode: true }));

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    importAgent,
    close,
    getLastServerInfoMessage: () => ({ features: { ...hostFeatures } }),
  })),
  getDaemonHost: vi.fn(() => "ws://127.0.0.1:6767"),
}));

describe("resolveImportCwd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostFeatures.importSessionMode = true;
  });

  it("uses the invoking process cwd when --cwd is omitted", () => {
    expect(resolveImportCwd(undefined, "/Volumes/data/dev/rolepai")).toBe(
      "/Volumes/data/dev/rolepai",
    );
  });

  it("uses explicit --cwd when provided", () => {
    expect(resolveImportCwd(" /tmp/project ", "/Volumes/data/dev/rolepai")).toBe("/tmp/project");
  });

  it("rejects an empty explicit --cwd", () => {
    expect(() => resolveImportCwd("  ", "/Volumes/data/dev/rolepai")).toThrow(
      expect.objectContaining({
        code: "INVALID_CWD",
      }),
    );
  });

  it("accepts pi as an import provider", async () => {
    importAgent.mockResolvedValueOnce({
      id: "agent-1",
      status: "idle",
      provider: "pi",
      cwd: "/tmp/project",
      title: "Imported Pi session",
    });

    const result = await runImportCommand(
      "pi-session-1",
      {
        provider: "pi",
        cwd: "/tmp/project",
      },
      {} as never,
    );

    expect(importAgent).toHaveBeenCalledWith({
      provider: "pi",
      sessionId: "pi-session-1",
      cwd: "/tmp/project",
    });
    expect(result.data.provider).toBe("pi");
  });

  it("forwards an explicit import timeout", async () => {
    importAgent.mockResolvedValueOnce({
      id: "agent-2",
      status: "idle",
      provider: "codex",
      cwd: "/tmp/project",
      title: "Imported Codex session",
    });

    await runImportCommand(
      "codex-session-1",
      {
        provider: "codex",
        cwd: "/tmp/project",
        timeout: "900",
      },
      {} as never,
    );

    expect(importAgent).toHaveBeenLastCalledWith({
      provider: "codex",
      sessionId: "codex-session-1",
      cwd: "/tmp/project",
      timeout: 900_000,
    });
  });

  it("forwards an explicit execution mode when the daemon supports it", async () => {
    importAgent.mockResolvedValueOnce({
      id: "agent-mode",
      status: "idle",
      provider: "codex",
      cwd: "/tmp/project",
      title: "Imported Codex session",
    });

    await runImportCommand(
      "codex-session-mode",
      {
        provider: "codex",
        cwd: "/tmp/project",
        mode: " full-access ",
      },
      {} as never,
    );

    expect(importAgent).toHaveBeenLastCalledWith({
      provider: "codex",
      sessionId: "codex-session-mode",
      cwd: "/tmp/project",
      modeId: "full-access",
    });
  });

  it("rejects --mode before import when the daemon does not support it", async () => {
    hostFeatures.importSessionMode = false;

    await expect(
      runImportCommand(
        "codex-session-mode",
        {
          provider: "codex",
          cwd: "/tmp/project",
          mode: "full-access",
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_BY_HOST" });

    expect(importAgent).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("parseImportTimeoutMs", () => {
  it("converts seconds to milliseconds", () => {
    expect(parseImportTimeoutMs("900")).toBe(900_000);
  });

  it("rejects non-positive values", () => {
    expect(() => parseImportTimeoutMs("0")).toThrow(
      expect.objectContaining({ code: "INVALID_TIMEOUT" }),
    );
  });
});
