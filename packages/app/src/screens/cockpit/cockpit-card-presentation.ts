export const COCKPIT_QUICK_REPLY_MIN_WIDTH = 360;
export const COCKPIT_QUICK_REPLY_MIN_HEIGHT = 300;
export const COCKPIT_INLINE_HEADER_MIN_WIDTH = 360;
// Cockpit cards need a stronger running signal than the dense sidebar list because users scan
// many larger surfaces at once. The wrapper reserves the scaled mark's full box to avoid reflow.
export const COCKPIT_STATUS_RING_FRAME_SIZE = 22;

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
