import { fileURLToPath } from "url";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  acquirePidLock,
  PidLockError,
  releasePidLock,
  startPidLockHeartbeat,
  updatePidLock,
} from "../src/server/pid-lock.js";
import { resolvePaseoHome } from "../src/server/paseo-home.js";
import { loadPersistedConfig } from "../src/server/persisted-config.js";
import {
  createPackagedWorkerSpawnSpec,
  DAEMON_ELECTRON_MAX_OLD_SPACE_SIZE_MB,
  DAEMON_NODE_MAX_OLD_SPACE_SIZE_MB,
  type PackagedWorkerRuntime,
  resolvePackagedNodeWorkerRuntime,
  resolveWorkerExecArgv,
} from "./daemon-worker-launch.js";
import { runSupervisor } from "./supervisor.js";
import { resolveSupervisorLogFile } from "./supervisor-log-config.js";
import { applySherpaLoaderEnv } from "../src/server/speech/providers/local/sherpa/sherpa-runtime-env.js";

process.title = "Paseo Supervisor";

interface DaemonRunnerConfig {
  devMode: boolean;
  reclaimStalePidLock: boolean;
  workerArgs: string[];
}

function parseConfig(argv: string[]): DaemonRunnerConfig {
  let devMode = false;
  let reclaimStalePidLock = false;
  const workerArgs: string[] = [];

  for (const arg of argv) {
    if (arg === "--dev") {
      devMode = true;
      continue;
    }
    if (arg === "--reclaim-stale-pid-lock") {
      reclaimStalePidLock = true;
      continue;
    }
    workerArgs.push(arg);
  }

  return { devMode, reclaimStalePidLock, workerArgs };
}

function resolveWorkerEntry(): string {
  const candidates = [
    fileURLToPath(new URL("../server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../dist/server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../src/server/daemon-worker.ts", import.meta.url)),
    fileURLToPath(new URL("../../src/server/daemon-worker.ts", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveDevWorkerEntry(): string {
  const candidate = fileURLToPath(new URL("../src/server/daemon-worker.ts", import.meta.url));
  if (!existsSync(candidate)) {
    throw new Error(`Dev worker entry not found: ${candidate}`);
  }
  return candidate;
}

function resolvePackagedNodeEntrypointRunnerPath(currentScriptPath: string): string | null {
  const packageMarker = `${path.sep}node_modules${path.sep}@getpaseo${path.sep}server${path.sep}`;
  const markerIndex = currentScriptPath.lastIndexOf(packageMarker);
  if (markerIndex === -1) {
    return null;
  }

  const appRoot = currentScriptPath.slice(0, markerIndex);
  const runnerPath = path.join(appRoot, "dist", "daemon", "node-entrypoint-runner.js");
  return existsSync(runnerPath) ? runnerPath : null;
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const workerEntry = config.devMode ? resolveDevWorkerEntry() : resolveWorkerEntry();
  const workerEnv: NodeJS.ProcessEnv = { ...process.env };
  const currentScriptPath = fileURLToPath(import.meta.url);
  const packagedNodeEntrypointRunner =
    process.env.ELECTRON_RUN_AS_NODE === "1"
      ? resolvePackagedNodeEntrypointRunnerPath(currentScriptPath)
      : null;
  const packagedWorkerRuntime: PackagedWorkerRuntime | null = packagedNodeEntrypointRunner
    ? (resolvePackagedNodeWorkerRuntime({ currentScriptPath, workerEntry }) ?? {
        kind: "electron",
        execPath: process.execPath,
        runnerPath: packagedNodeEntrypointRunner,
        workerEntry,
      })
    : null;
  const resolvedWorkerEntry = packagedWorkerRuntime?.workerEntry ?? workerEntry;
  const workerExecArgv = resolveWorkerExecArgv(
    resolvedWorkerEntry,
    config.devMode,
    packagedWorkerRuntime?.kind === "electron"
      ? DAEMON_ELECTRON_MAX_OLD_SPACE_SIZE_MB
      : DAEMON_NODE_MAX_OLD_SPACE_SIZE_MB,
  );

  applySherpaLoaderEnv(workerEnv);

  const paseoHome = resolvePaseoHome(workerEnv);
  const persistedConfig = loadPersistedConfig(paseoHome);
  const supervisorLogFile = resolveSupervisorLogFile(paseoHome, persistedConfig, workerEnv);

  try {
    await acquirePidLock(paseoHome, null, {
      ownerPid: process.pid,
      reclaimStaleDesktopLock: config.reclaimStalePidLock,
    });
  } catch (error) {
    if (error instanceof PidLockError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
      return;
    }
    throw error;
  }

  let lockReleased = false;
  let requestSupervisorShutdown: ((reason: string) => void) | null = null;
  const stopLockHeartbeat = startPidLockHeartbeat(paseoHome, {
    ownerPid: process.pid,
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`PID lock heartbeat failed: ${message}\n`);
      if (error instanceof PidLockError) {
        requestSupervisorShutdown?.("pid_lock_ownership_lost");
      }
    },
  });
  const releaseLock = async (): Promise<void> => {
    if (lockReleased) {
      return;
    }
    lockReleased = true;
    stopLockHeartbeat();
    await releasePidLock(paseoHome, {
      ownerPid: process.pid,
    });
  };

  const supervisor = runSupervisor({
    name: "DaemonRunner",
    startupMessage: "Starting daemon worker (IPC restart and crash restart enabled)",
    resolveWorkerEntry: () => resolvedWorkerEntry,
    workerArgs: config.workerArgs,
    workerEnv,
    workerExecArgv,
    resolveWorkerSpawnSpec: packagedWorkerRuntime
      ? (spawnWorkerEntry) =>
          createPackagedWorkerSpawnSpec({
            runtime: {
              ...packagedWorkerRuntime,
              workerEntry: spawnWorkerEntry,
            },
            workerArgs: config.workerArgs,
            workerEnv,
            workerExecArgv,
          })
      : undefined,
    restartOnCrash: true,
    logFile: supervisorLogFile,
    onWorkerReady: async ({ listen }) => {
      await updatePidLock(paseoHome, { listen }, { ownerPid: process.pid });
    },
    onSupervisorExit: releaseLock,
  });
  requestSupervisorShutdown = supervisor.requestShutdown;
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
