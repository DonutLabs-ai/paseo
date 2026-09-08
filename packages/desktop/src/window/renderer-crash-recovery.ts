import type { RenderProcessGoneDetails } from "electron";

const RECOVERABLE_RENDERER_EXIT_REASONS: ReadonlySet<RenderProcessGoneDetails["reason"]> = new Set([
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "memory-eviction",
]);

export function shouldReloadRendererAfterExit(input: {
  reason: RenderProcessGoneDetails["reason"];
  recoveryAlreadyAttempted: boolean;
}): boolean {
  return !input.recoveryAlreadyAttempted && RECOVERABLE_RENDERER_EXIT_REASONS.has(input.reason);
}
