import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ClientMessage,
  ServerMessage,
  TerminalCommandFinishedInfo,
  TerminalExitInfo,
  TerminalSession,
  TerminalStateSnapshotOptions,
  TerminalSubscribeOptions,
} from "./terminal.js";
import type { TerminalManager } from "./terminal-manager.js";
import { createUtilityTerminalService } from "./utility-terminal-service.js";

interface FakeTerminalHandle {
  session: TerminalSession;
  emitExit(info: TerminalExitInfo): void;
}

interface FakeTerminalManager {
  manager: TerminalManager;
  createCalls: Array<Parameters<TerminalManager["createTerminal"]>[0]>;
  handles: Map<string, FakeTerminalHandle>;
}

const cleanupDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createPaseoHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "paseo-utility-terminals-"));
  cleanupDirectories.push(directory);
  return directory;
}

function createFakeTerminal(
  id: string,
  options: { cwd: string; name?: string },
): FakeTerminalHandle {
  const exitListeners = new Set<(info: TerminalExitInfo) => void>();
  let exitInfo: TerminalExitInfo | null = null;
  const state = {
    rows: 24,
    cols: 80,
    grid: [],
    scrollback: [],
    cursor: { row: 0, col: 0 },
  };
  const session: TerminalSession = {
    id,
    name: options.name ?? "Terminal",
    cwd: options.cwd,
    send(_message: ClientMessage): void {},
    subscribe(
      _listener: (message: ServerMessage) => void,
      _options?: TerminalSubscribeOptions,
    ): () => void {
      return () => undefined;
    },
    onExit(listener): () => void {
      const existingExitInfo = exitInfo;
      if (existingExitInfo) {
        queueMicrotask(() => listener(existingExitInfo));
        return () => undefined;
      }
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    onCommandFinished(_listener: (info: TerminalCommandFinishedInfo) => void): () => void {
      return () => undefined;
    },
    onTitleChange(): () => void {
      return () => undefined;
    },
    onActivityChange(): () => void {
      return () => undefined;
    },
    getSize: () => ({ rows: state.rows, cols: state.cols }),
    getState: () => state,
    getStateSnapshot(_options?: TerminalStateSnapshotOptions) {
      return { state, revision: 0 };
    },
    getReplayPreamble: () => "",
    getTitle: () => options.name,
    getActivity: () => null,
    setActivity(): void {},
    clearActivityAttention: () => false,
    setTitle(): void {},
    getExitInfo: () => exitInfo,
    kill(): void {},
    killAndWait: async () => undefined,
  };
  return {
    session,
    emitExit(info) {
      if (exitInfo) return;
      exitInfo = info;
      for (const listener of exitListeners) listener(info);
      exitListeners.clear();
    },
  };
}

function createFakeTerminalManager(): FakeTerminalManager {
  const handles = new Map<string, FakeTerminalHandle>();
  const createCalls: Array<Parameters<TerminalManager["createTerminal"]>[0]> = [];
  let nextId = 1;
  const manager: TerminalManager = {
    getTerminals: async () => Array.from(handles.values(), (handle) => handle.session),
    createTerminal: async (options) => {
      createCalls.push(options);
      const handle = createFakeTerminal(`terminal-${nextId++}`, options);
      handles.set(handle.session.id, handle);
      return handle.session;
    },
    registerCwdEnv(): void {},
    validateTerminalActivityToken: () => "unknown",
    getTerminal: (id) => handles.get(id)?.session,
    getTerminalState: async () => null,
    setTerminalTitle: () => false,
    setTerminalActivity: async () => false,
    clearTerminalAttention: async () => false,
    killTerminal(id): void {
      handles.get(id)?.emitExit({ exitCode: null, signal: null, lastOutputLines: [] });
      handles.delete(id);
    },
    async killTerminalAndWait(id): Promise<void> {
      handles.get(id)?.emitExit({ exitCode: null, signal: null, lastOutputLines: [] });
      handles.delete(id);
    },
    captureTerminal: async () => ({ lines: [], totalLines: 0 }),
    listDirectories: () => [],
    killAll(): void {},
    subscribeTerminalsChanged: () => () => undefined,
    subscribeTerminalActivity: () => () => undefined,
    subscribeTerminalWorkspaceContributionChanged: () => () => undefined,
  };
  return { manager, createCalls, handles };
}

describe("utility terminal service", () => {
  it("creates a daemon-owned terminal without a workspace owner", async () => {
    const paseoHome = await createPaseoHome();
    const fake = createFakeTerminalManager();
    const service = createUtilityTerminalService({
      paseoHome,
      terminalManager: fake.manager,
      logger: pino({ enabled: false }),
    });

    const created = await service.create({
      name: "Process Compose",
      cwd: "/repo",
      command: "process-compose",
      args: ["-f", "process-compose.yaml"],
    });

    expect(created).toMatchObject({
      name: "Process Compose",
      status: "running",
      terminalId: "terminal-1",
    });
    expect(fake.createCalls).toEqual([
      expect.objectContaining({
        cwd: "/repo",
        command: "process-compose",
        args: ["-f", "process-compose.yaml"],
      }),
    ]);
    expect(fake.createCalls[0]).not.toHaveProperty("workspaceId");
  });

  it("keeps the definition and records the exit when the process ends", async () => {
    const paseoHome = await createPaseoHome();
    const fake = createFakeTerminalManager();
    const service = createUtilityTerminalService({
      paseoHome,
      terminalManager: fake.manager,
      logger: pino({ enabled: false }),
    });
    const created = await service.create({ name: "Worker", cwd: "/repo" });
    if (!created.terminalId) {
      throw new Error("Expected the created utility terminal to be running");
    }

    fake.handles.get(created.terminalId)?.emitExit({
      exitCode: 7,
      signal: null,
      lastOutputLines: ["failed"],
    });

    await vi.waitFor(() => {
      expect(service.list()[0]).toMatchObject({
        id: created.id,
        status: "stopped",
        terminalId: null,
        exitCode: 7,
      });
    });
  });

  it("restores persisted definitions as stopped after daemon restart", async () => {
    const paseoHome = await createPaseoHome();
    const firstManager = createFakeTerminalManager();
    const first = createUtilityTerminalService({
      paseoHome,
      terminalManager: firstManager.manager,
      logger: pino({ enabled: false }),
    });
    const created = await first.create({ name: "Watcher", cwd: "/repo", command: "watch" });

    const secondManager = createFakeTerminalManager();
    const restored = createUtilityTerminalService({
      paseoHome,
      terminalManager: secondManager.manager,
      logger: pino({ enabled: false }),
    });

    expect(restored.list()).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Watcher",
        status: "stopped",
        terminalId: null,
      }),
    ]);
    expect(secondManager.createCalls).toHaveLength(0);
  });

  it("starts, stops, and removes a retained definition", async () => {
    const paseoHome = await createPaseoHome();
    const fake = createFakeTerminalManager();
    const service = createUtilityTerminalService({
      paseoHome,
      terminalManager: fake.manager,
      logger: pino({ enabled: false }),
    });
    const created = await service.create({ name: "Worker", cwd: "/repo" });

    const stopped = await service.stop(created.id);
    expect(stopped).toMatchObject({ status: "stopped", terminalId: null });

    const restarted = await service.start(created.id);
    expect(restarted).toMatchObject({ status: "running", terminalId: "terminal-2" });

    await expect(service.remove(created.id)).resolves.toBe(true);
    expect(service.list()).toEqual([]);
  });
});
