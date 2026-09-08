import { describe, expect, it } from "vitest";
import { shouldReloadRendererAfterExit } from "./renderer-crash-recovery.js";

describe("shouldReloadRendererAfterExit", () => {
  it.each(["abnormal-exit", "killed", "crashed", "oom", "memory-eviction"] as const)(
    "recovers once after a transient %s renderer failure",
    (reason) => {
      expect(
        shouldReloadRendererAfterExit({
          reason,
          recoveryAlreadyAttempted: false,
        }),
      ).toBe(true);
      expect(
        shouldReloadRendererAfterExit({
          reason,
          recoveryAlreadyAttempted: true,
        }),
      ).toBe(false);
    },
  );

  it.each(["clean-exit", "launch-failed", "integrity-failure"] as const)(
    "does not reload after %s because repeating the launch cannot repair it",
    (reason) => {
      expect(
        shouldReloadRendererAfterExit({
          reason,
          recoveryAlreadyAttempted: false,
        }),
      ).toBe(false);
    },
  );
});
