import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { createDaemonCommandHandlers, isolateDetachedDaemonInvocation } from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  paseoHome: "",
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  spawnProcess: vi.fn(),
  startDaemonInstance: vi.fn(),
  stopDaemonInstance: vi.fn(),
  readDaemonInstance: vi.fn(),
  isSameDaemonInstance: vi.fn(() => false),
  logInfo: vi.fn(),
  logError: vi.fn(),
  appLogPath: "",
  getElectronLogFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => mocks.paseoHome),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: true,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: mocks.logInfo,
    error: mocks.logError,
    transports: {
      file: {
        getFile: mocks.getElectronLogFile,
      },
    },
  },
}));

vi.mock("@getpaseo/server", () => {
  class DaemonInstanceError extends Error {
    constructor(
      public readonly code: string,
      message?: string,
    ) {
      super(message ?? code);
      this.name = "DaemonInstanceError";
    }
  }
  return {
    resolvePaseoHome: vi.fn(() => mocks.paseoHome),
    spawnProcess: mocks.spawnProcess,
    startDaemonInstance: mocks.startDaemonInstance,
    stopDaemonInstance: mocks.stopDaemonInstance,
    readDaemonInstance: mocks.readDaemonInstance,
    isSameDaemonInstance: mocks.isSameDaemonInstance,
    DaemonInstanceError,
  };
});

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: vi.fn(),
    migrateLegacyRendererSettings: vi.fn(),
  }),
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: mocks.createNodeEntrypointInvocation,
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: path.join(mocks.paseoHome, "daemon.js"),
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", () => ({
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

describe("daemon-manager commands", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "paseo daemon manager "));
    mocks.paseoHome = path.join(fixtureRoot, "home");
    mocks.appLogPath = path.join(fixtureRoot, "main.log");
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.createNodeEntrypointInvocation.mockReset();
    mocks.createNodeEntrypointInvocation.mockReturnValue({ command: "node", args: [], env: {} });
    mocks.spawnProcess.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.getElectronLogFile.mockReset();
    mocks.getElectronLogFile.mockReturnValue({ path: mocks.appLogPath });
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(mocks.appLogPath, { force: true });
  });

  it("launches the daemon through a Bash file-descriptor isolation boundary", () => {
    const isolated = isolateDetachedDaemonInvocation(
      "/opt/Donut Paseo/donut-paseo",
      ["daemon runner.js", "--flag=$(touch /tmp/not-executed)"],
      "linux",
    );

    expect(isolated.command).toBe("bash");
    expect(isolated.args[0]).toBe("-c");
    expect(isolated.args[1]).toContain('exec "$@"');
    expect(isolated.args.slice(2)).toEqual([
      "paseo-daemon-fd-boundary",
      "/opt/Donut Paseo/donut-paseo",
      "daemon runner.js",
      "--flag=$(touch /tmp/not-executed)",
    ]);
  });

  it.runIf(process.platform !== "win32")(
    "closes inherited file descriptors above 9 before launching the daemon",
    () => {
      const isolated = isolateDetachedDaemonInvocation(
        process.execPath,
        ["-e", "process.exit(0)"],
        process.platform,
      );
      const result = spawnSync(isolated.command, isolated.args, {
        encoding: "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe",
          "ignore",
          "ignore",
          "ignore",
          "ignore",
          "ignore",
          "ignore",
          "ignore",
          "ignore",
        ],
      });

      if (result.error) {
        throw result.error;
      }
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    },
  );

  it("keeps the direct daemon invocation on Windows", () => {
    expect(isolateDetachedDaemonInvocation("node.exe", ["daemon.js"], "win32")).toEqual({
      command: "node.exe",
      args: ["daemon.js"],
    });
  });

  it("returns the Electron main-process log tail from electron-log", () => {
    writeFileSync(
      mocks.appLogPath,
      Array.from({ length: 105 }, (_value, index) => `main log line ${index + 1}`).join("\n"),
    );
    const handlers = createDaemonCommandHandlers();

    expect(handlers.desktop_app_logs()).toEqual({
      logPath: mocks.appLogPath,
      contents: Array.from({ length: 100 }, (_value, index) => `main log line ${index + 6}`).join(
        "\n",
      ),
    });
  });

  it("exposes updater diagnostics through the desktop command boundary", () => {
    const diagnostics = createDaemonCommandHandlers().desktop_update_diagnostics();

    expect(diagnostics).toMatchObject({
      platform: process.platform,
      currentVersion: "1.2.3",
    });
  });
});
