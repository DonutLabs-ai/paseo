import {
  STATUS_RING_LARGE_CENTER_DOT_SIZE,
  STATUS_RING_LARGE_FRAME_SIZE,
} from "@/components/status-ring/geometry";

export const COCKPIT_QUICK_REPLY_MIN_WIDTH = 360;
export const COCKPIT_QUICK_REPLY_MIN_HEIGHT = 300;
export const COCKPIT_INLINE_HEADER_MIN_WIDTH = 360;
// Cockpit cards need a stronger running signal than the dense sidebar list because users scan
// many larger surfaces at once. The wrapper reserves the large mark's full box to avoid reflow.
export const COCKPIT_STATUS_RING_FRAME_SIZE = STATUS_RING_LARGE_FRAME_SIZE;
// Passive states share the running mark's centre diameter so changing Cockpit's large status
// geometry cannot leave idle, needs-input, or attention indicators visually undersized.
export const COCKPIT_STATUS_DOT_SIZE = STATUS_RING_LARGE_CENTER_DOT_SIZE;
export const COCKPIT_CARD_TITLE_LINE_HEIGHT = 20;
export const COCKPIT_STATUS_DOT_MARGIN_TOP =
  (COCKPIT_CARD_TITLE_LINE_HEIGHT - COCKPIT_STATUS_DOT_SIZE) / 2;

export function shouldStackCockpitCardHeader(width: number): boolean {
  return width < COCKPIT_INLINE_HEADER_MIN_WIDTH;
}

export function shouldShowCockpitQuickReply(input: {
  width: number;
  height: number;
  hasAgent: boolean;
}): boolean {
  return (
    input.hasAgent &&
    input.width >= COCKPIT_QUICK_REPLY_MIN_WIDTH &&
    input.height >= COCKPIT_QUICK_REPLY_MIN_HEIGHT
  );
}
