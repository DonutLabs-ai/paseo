import { describe, expect, it } from "vitest";
import { resolveCockpitQuickReplyAction } from "./cockpit-quick-reply";

describe("cockpit quick reply action", () => {
  it("queues behind a running agent when queue is the default", () => {
    expect(
      resolveCockpitQuickReplyAction({
        sendBehavior: "queue",
        isAgentRunning: true,
        hasPendingPermission: false,
      }),
    ).toEqual({ kind: "queue" });
  });

  it("interrupts instead of stranding a reply behind a permission prompt", () => {
    expect(
      resolveCockpitQuickReplyAction({
        sendBehavior: "queue",
        isAgentRunning: true,
        hasPendingPermission: true,
      }),
    ).toEqual({ kind: "send", activeTurnBehavior: "interrupt" });
  });

  it("preserves steering and sends immediately when the agent is idle", () => {
    expect(
      resolveCockpitQuickReplyAction({
        sendBehavior: "steer",
        isAgentRunning: true,
        hasPendingPermission: false,
      }),
    ).toEqual({ kind: "send", activeTurnBehavior: "steer" });
    expect(
      resolveCockpitQuickReplyAction({
        sendBehavior: "queue",
        isAgentRunning: false,
        hasPendingPermission: false,
      }),
    ).toEqual({ kind: "send", activeTurnBehavior: "interrupt" });
  });
});
