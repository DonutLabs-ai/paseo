import { describe, expect, it } from "vitest";
import { resolveWorkspaceOpenIntentConsumption } from "./workspace-open-intent-consumption";

describe("resolveWorkspaceOpenIntentConsumption", () => {
  it("does not consume the same stale open intent after the workspace route changes", () => {
    const first = resolveWorkspaceOpenIntentConsumption({
      openValue: "agent:agent-1",
      consumedOpenValue: null,
    });
    const afterWorkspaceSwitch = resolveWorkspaceOpenIntentConsumption({
      openValue: "agent:agent-1",
      consumedOpenValue: first.nextConsumedOpenValue,
    });

    expect(first).toEqual({
      shouldConsume: true,
      nextConsumedOpenValue: "agent:agent-1",
    });
    expect(afterWorkspaceSwitch).toEqual({
      shouldConsume: false,
      nextConsumedOpenValue: "agent:agent-1",
    });
  });

  it("allows the same intent again after the route param was cleared", () => {
    const cleared = resolveWorkspaceOpenIntentConsumption({
      openValue: "",
      consumedOpenValue: "agent:agent-1",
    });
    const reopened = resolveWorkspaceOpenIntentConsumption({
      openValue: "agent:agent-1",
      consumedOpenValue: cleared.nextConsumedOpenValue,
    });

    expect(cleared).toEqual({ shouldConsume: false, nextConsumedOpenValue: null });
    expect(reopened.shouldConsume).toBe(true);
  });
});
