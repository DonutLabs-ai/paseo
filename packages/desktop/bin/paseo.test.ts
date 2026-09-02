import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe.runIf(process.platform === "linux")("bundled Paseo CLI shim", () => {
  test("launches the Donut Paseo executable", () => {
    const appDirectory = mkdtempSync(path.join(tmpdir(), "donut-paseo-cli-shim-"));
    temporaryDirectories.push(appDirectory);
    const binDirectory = path.join(appDirectory, "resources", "bin");
    mkdirSync(binDirectory, { recursive: true });

    const shimPath = path.join(binDirectory, "paseo");
    copyFileSync(path.join(import.meta.dirname, "paseo"), shimPath);
    chmodSync(shimPath, 0o755);

    const executablePath = path.join(appDirectory, "donut-paseo");
    writeFileSync(executablePath, '#!/bin/sh\nprintf "%s\\n" "$0"\n', { mode: 0o755 });

    const output = execFileSync(shimPath, ["status", "--json"], { encoding: "utf8" });

    expect(realpathSync(output.trim())).toBe(realpathSync(executablePath));
  });
});
