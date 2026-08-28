import { describe, expect, it } from "vitest";
import {
  COCKPIT_CARD_GAP,
  resolveCockpitCardWidth,
  resolveCockpitColumnCount,
} from "./cockpit-layout";

describe("cockpit card layout", () => {
  it("uses one column below the minimum two-card width", () => {
    expect(resolveCockpitColumnCount(611)).toBe(1);
  });

  it("uses two columns once two cards and their gap fit", () => {
    expect(resolveCockpitColumnCount(612)).toBe(2);
    expect(resolveCockpitCardWidth(612)).toBe(300);
  });

  it("caps wide layouts at three readable columns", () => {
    expect(resolveCockpitColumnCount(2_000)).toBe(3);
    expect(resolveCockpitCardWidth(2_000)).toBe((2_000 - COCKPIT_CARD_GAP * 2) / 3);
  });

  it("returns a safe initial layout before measurement", () => {
    expect(resolveCockpitColumnCount(0)).toBe(1);
    expect(resolveCockpitCardWidth(0)).toBeNull();
  });
});
