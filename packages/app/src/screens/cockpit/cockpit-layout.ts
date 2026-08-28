export const COCKPIT_CARD_GAP = 12;
export const COCKPIT_CARD_MIN_WIDTH = 300;
export const COCKPIT_CARD_MAX_COLUMNS = 3;
export const COCKPIT_HORIZONTAL_PADDING = 16;

export function resolveCockpitColumnCount(availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return 1;
  }
  const columns = Math.floor(
    (availableWidth + COCKPIT_CARD_GAP) / (COCKPIT_CARD_MIN_WIDTH + COCKPIT_CARD_GAP),
  );
  return Math.max(1, Math.min(COCKPIT_CARD_MAX_COLUMNS, columns));
}

export function resolveCockpitCardWidth(availableWidth: number): number | null {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return null;
  }
  const columns = resolveCockpitColumnCount(availableWidth);
  return (availableWidth - COCKPIT_CARD_GAP * (columns - 1)) / columns;
}
