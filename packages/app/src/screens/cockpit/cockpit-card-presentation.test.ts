import { describe, expect, it } from "vitest";
import { STATUS_RING_LARGE_CENTER_DOT_SIZE } from "@/components/status-ring/geometry";
import {
  COCKPIT_CARD_TITLE_LINE_HEIGHT,
  COCKPIT_INLINE_HEADER_MIN_WIDTH,
  COCKPIT_QUICK_REPLY_MIN_HEIGHT,
  COCKPIT_QUICK_REPLY_MIN_WIDTH,
  COCKPIT_STATUS_DOT_MARGIN_TOP,
  COCKPIT_STATUS_DOT_SIZE,
  shouldStackCockpitCardHeader,
  shouldShowCockpitQuickReply,
} from "./cockpit-card-presentation";

describe("cockpit card presentation", () => {
  it("keeps passive status dots as prominent as the large running indicator centre", () => {
    expect(COCKPIT_STATUS_DOT_SIZE).toBe(STATUS_RING_LARGE_CENTER_DOT_SIZE);
    expect(COCKPIT_STATUS_DOT_MARGIN_TOP * 2 + COCKPIT_STATUS_DOT_SIZE).toBe(
      COCKPIT_CARD_TITLE_LINE_HEIGHT,
    );
  });

  it("stacks fixed-width header controls before they consume the card title", () => {
    expect(shouldStackCockpitCardHeader(0)).toBe(true);
    expect(shouldStackCockpitCardHeader(COCKPIT_INLINE_HEADER_MIN_WIDTH - 1)).toBe(true);
    expect(shouldStackCockpitCardHeader(COCKPIT_INLINE_HEADER_MIN_WIDTH)).toBe(false);
  });

  it("shows quick reply only when both card dimensions can accommodate it", () => {
    expect(
      shouldShowCockpitQuickReply({
        width: COCKPIT_QUICK_REPLY_MIN_WIDTH,
        height: COCKPIT_QUICK_REPLY_MIN_HEIGHT,
        hasAgent: true,
      }),
    ).toBe(true);
    expect(
      shouldShowCockpitQuickReply({
        width: COCKPIT_QUICK_REPLY_MIN_WIDTH - 1,
        height: COCKPIT_QUICK_REPLY_MIN_HEIGHT,
        hasAgent: true,
      }),
    ).toBe(false);
    expect(
      shouldShowCockpitQuickReply({
        width: COCKPIT_QUICK_REPLY_MIN_WIDTH,
        height: COCKPIT_QUICK_REPLY_MIN_HEIGHT - 1,
        hasAgent: true,
      }),
    ).toBe(false);
  });

  it("does not show quick reply without an existing agent", () => {
    expect(
      shouldShowCockpitQuickReply({
        width: 1_000,
        height: 1_000,
        hasAgent: false,
      }),
    ).toBe(false);
  });
});
