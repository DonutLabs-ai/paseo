export const COCKPIT_QUICK_REPLY_MIN_WIDTH = 360;
export const COCKPIT_QUICK_REPLY_MIN_HEIGHT = 300;
export const COCKPIT_INLINE_HEADER_MIN_WIDTH = 360;

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
