import type { UtilityTerminalInfo } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import {
  getUtilityTerminalFailureIds,
  utilityTerminalNeedsAttention,
} from "./utility-terminal-health";

const TIMESTAMP = "2026-09-08T12:00:00.000Z";

function createUtilityTerminal(overrides: Partial<UtilityTerminalInfo> = {}): UtilityTerminalInfo {
  return {
    id: "utility-1",
    name: "Worker",
    cwd: "/repo",
    command: "worker",
    args: [],
    status: "stopped",
    desiredState: "stopped",
    terminalId: null,
    exitCode: null,
    lastExit: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function createLastExit(
  reason: NonNullable<UtilityTerminalInfo["lastExit"]>["reason"],
): NonNullable<UtilityTerminalInfo["lastExit"]> {
  return {
    exitCode: reason === "process-exit" ? 0 : null,
    signal: null,
    lastOutputLines: [],
    reason,
    message: reason === "launch-failed" ? "worker executable not found" : null,
    at: TIMESTAMP,
  };
}

describe("utility terminal health", () => {
  it.each(["process-exit", "launch-failed", "legacy"] as const)(
    "marks a stopped %s record as needing attention",
    (reason) => {
      expect(
        utilityTerminalNeedsAttention(createUtilityTerminal({ lastExit: createLastExit(reason) })),
      ).toBe(true);
    },
  );

  it("does not flag a terminal that was stopped deliberately", () => {
    expect(utilityTerminalNeedsAttention(createUtilityTerminal())).toBe(false);
  });

  it("does not flag a terminal interrupted by an expected daemon restart", () => {
    expect(
      utilityTerminalNeedsAttention(
        createUtilityTerminal({
          desiredState: "running",
          lastExit: createLastExit("daemon-shutdown"),
        }),
      ),
    ).toBe(false);
  });

  it("does not flag a running terminal even if an old exit record is present", () => {
    expect(
      utilityTerminalNeedsAttention(
        createUtilityTerminal({
          status: "running",
          desiredState: "running",
          terminalId: "terminal-1",
          lastExit: createLastExit("process-exit"),
        }),
      ),
    ).toBe(false);
  });

  it("returns the identities of every failed utility terminal", () => {
    expect(
      getUtilityTerminalFailureIds([
        createUtilityTerminal({ id: "manual-stop" }),
        createUtilityTerminal({
          id: "failed",
          lastExit: createLastExit("process-exit"),
        }),
        createUtilityTerminal({
          id: "launch-failed",
          lastExit: createLastExit("launch-failed"),
        }),
      ]),
    ).toEqual(["failed", "launch-failed"]);
  });
});
