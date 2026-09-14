import { existsSync } from "node:fs";
import path from "node:path";

export const DAEMON_NODE_MAX_OLD_SPACE_SIZE_MB = 8 * 1024;
export const DAEMON_ELECTRON_MAX_OLD_SPACE_SIZE_MB = 4 * 1024;

export type PackagedWorkerRuntime =
  | {
      kind: "node";
      execPath: string;
      workerEntry: string;
    }
  | {
      kind: "electron";
      execPath: string;
      runnerPath: string;
      workerEntry: string;
    };

interface PackagedWorkerSpawnSpecInput {
  runtime: PackagedWorkerRuntime;
  workerArgs: string[];
  workerEnv: NodeJS.ProcessEnv;
  workerExecArgv: string[];
}

export function resolveWorkerExecArgv(
  workerEntry: string,
  devMode: boolean,
  maxOldSpaceSizeMb = DAEMON_NODE_MAX_OLD_SPACE_SIZE_MB,
  inspectArg = process.env.PASEO_NODE_INSPECT ?? "--inspect",
): string[] {
  const runtimeArgs = [`--max-old-space-size=${maxOldSpaceSizeMb}`];
  const loaderArgs = workerEntry.endsWith(".ts") ? ["--import", "tsx"] : [];
  if (!devMode) {
    return [...runtimeArgs, ...loaderArgs];
  }

  const diagnosticArgs = [
    "--heapsnapshot-near-heap-limit=3",
    "--report-on-fatalerror",
    "--report-directory=/tmp/paseo-reports",
  ];
  if (inspectArg !== "0" && inspectArg !== "false" && inspectArg !== "off") {
    diagnosticArgs.push(inspectArg);
  }
  return [...runtimeArgs, ...diagnosticArgs, ...loaderArgs];
}

export function resolvePackagedNodeWorkerRuntime(input: {
  currentScriptPath: string;
  workerEntry: string;
  pathExists?: (filePath: string) => boolean;
}): Extract<PackagedWorkerRuntime, { kind: "node" }> | null {
  const packageMarker = `${path.sep}node_modules${path.sep}@getpaseo${path.sep}server${path.sep}`;
  const markerIndex = input.currentScriptPath.lastIndexOf(packageMarker);
  if (markerIndex === -1) {
    return null;
  }

  const appRoot = input.currentScriptPath.slice(0, markerIndex);
  const relativeWorkerEntry = path.relative(appRoot, input.workerEntry);
  if (relativeWorkerEntry.startsWith(`..${path.sep}`) || path.isAbsolute(relativeWorkerEntry)) {
    return null;
  }

  const nodeExecutable = process.platform === "win32" ? "node.exe" : "node";
  const runtime = {
    kind: "node" as const,
    execPath: path.join(path.dirname(appRoot), "node-runtime", nodeExecutable),
    workerEntry: path.join(`${appRoot}.unpacked`, relativeWorkerEntry),
  };
  const pathExists = input.pathExists ?? existsSync;
  return pathExists(runtime.execPath) && pathExists(runtime.workerEntry) ? runtime : null;
}

export function createPackagedWorkerSpawnSpec(input: PackagedWorkerSpawnSpecInput): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  if (input.runtime.kind === "node") {
    const env = { ...input.workerEnv };
    delete env.ELECTRON_RUN_AS_NODE;
    return {
      command: input.runtime.execPath,
      args: [...input.workerExecArgv, input.runtime.workerEntry, ...input.workerArgs],
      env,
    };
  }

  return {
    command: input.runtime.execPath,
    args: [
      ...input.workerExecArgv,
      input.runtime.runnerPath,
      "node-script",
      input.runtime.workerEntry,
      ...input.workerArgs,
    ],
    env: {
      ...input.workerEnv,
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}
