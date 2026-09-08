import type { UtilityTerminalInfo } from "@getpaseo/protocol/messages";

export function utilityTerminalNeedsAttention(terminal: UtilityTerminalInfo): boolean {
  if (terminal.status === "running") return false;

  const reason = terminal.lastExit?.reason;
  return reason === "process-exit" || reason === "launch-failed" || reason === "legacy";
}

export function getUtilityTerminalFailureIds(terminals: UtilityTerminalInfo[]): string[] {
  return terminals.filter(utilityTerminalNeedsAttention).map((terminal) => terminal.id);
}
