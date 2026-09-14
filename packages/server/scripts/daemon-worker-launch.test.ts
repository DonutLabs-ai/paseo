import { describe, expect, it } from "vitest";
import {
  createPackagedWorkerSpawnSpec,
  resolvePackagedNodeWorkerRuntime,
  resolveWorkerExecArgv,
} from "./daemon-worker-launch";

describe("daemon worker launch", () => {
  it("gives production daemon workers an 8 GiB old-space limit", () => {
    expect(resolveWorkerExecArgv("/opt/paseo/daemon-worker.js", false)).toEqual([
      "--max-old-space-size=8192",
    ]);
  });

  it("maps packaged ASAR workers to the bundled Node runtime", () => {
    expect(
      resolvePackagedNodeWorkerRuntime({
        currentScriptPath:
          "/opt/Donut Paseo/resources/app.asar/node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js",
        workerEntry:
          "/opt/Donut Paseo/resources/app.asar/node_modules/@getpaseo/server/dist/server/server/daemon-worker.js",
        pathExists: () => true,
      }),
    ).toEqual({
      kind: "node",
      execPath: "/opt/Donut Paseo/resources/node-runtime/node",
      workerEntry:
        "/opt/Donut Paseo/resources/app.asar.unpacked/node_modules/@getpaseo/server/dist/server/server/daemon-worker.js",
    });
  });

  it("launches unpacked workers directly with the bundled Node runtime", () => {
    expect(
      createPackagedWorkerSpawnSpec({
        runtime: {
          kind: "node",
          execPath: "/opt/Donut Paseo/resources/node-runtime/node",
          workerEntry:
            "/opt/Donut Paseo/resources/app.asar.unpacked/node_modules/@getpaseo/server/dist/server/server/daemon-worker.js",
        },
        workerArgs: ["--desktop-managed"],
        workerEnv: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" },
        workerExecArgv: ["--max-old-space-size=8192"],
      }),
    ).toEqual({
      command: "/opt/Donut Paseo/resources/node-runtime/node",
      args: [
        "--max-old-space-size=8192",
        "/opt/Donut Paseo/resources/app.asar.unpacked/node_modules/@getpaseo/server/dist/server/server/daemon-worker.js",
        "--desktop-managed",
      ],
      env: {
        PATH: "/usr/bin",
      },
    });
  });

  it("keeps the Electron runner fallback for packages without a bundled Node runtime", () => {
    expect(
      createPackagedWorkerSpawnSpec({
        runtime: {
          kind: "electron",
          execPath: "/opt/Paseo/paseo",
          runnerPath: "/opt/Paseo/resources/app.asar.unpacked/dist/daemon/runner.js",
          workerEntry: "/opt/Paseo/resources/app.asar/node_modules/server/daemon-worker.js",
        },
        workerArgs: [],
        workerEnv: { PATH: "/usr/bin" },
        workerExecArgv: ["--max-old-space-size=4096"],
      }),
    ).toEqual({
      command: "/opt/Paseo/paseo",
      args: [
        "--max-old-space-size=4096",
        "/opt/Paseo/resources/app.asar.unpacked/dist/daemon/runner.js",
        "node-script",
        "/opt/Paseo/resources/app.asar/node_modules/server/daemon-worker.js",
      ],
      env: {
        PATH: "/usr/bin",
        ELECTRON_RUN_AS_NODE: "1",
      },
    });
  });
});
