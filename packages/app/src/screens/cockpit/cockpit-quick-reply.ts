import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import { resolveActiveSendBehavior, type SendBehavior } from "@/composer/input/state";

export type CockpitQuickReplyAction =
  | { kind: "queue" }
  | { kind: "send"; activeTurnBehavior: ActiveTurnBehavior };

export function resolveCockpitQuickReplyAction(input: {
  sendBehavior: SendBehavior;
  isAgentRunning: boolean;
  hasPendingPermission: boolean;
}): CockpitQuickReplyAction {
  const behavior = resolveActiveSendBehavior(input.sendBehavior, input.hasPendingPermission);
  if (behavior === "queue" && input.isAgentRunning) {
    return { kind: "queue" };
  }
  return {
    kind: "send",
    activeTurnBehavior: behavior === "steer" ? "steer" : "interrupt",
  };
}
