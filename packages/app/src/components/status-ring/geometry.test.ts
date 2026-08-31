import { describe, expect, it } from "vitest";
import {
  STATUS_RING_LARGE_CENTER_DOT_SIZE,
  STATUS_RING_LARGE_FRAME_SIZE,
  STATUS_RING_LARGE_SIZE,
} from "./geometry";

describe("large status ring geometry", () => {
  it("centres every independently painted layer on integer pixels", () => {
    expect(STATUS_RING_LARGE_FRAME_SIZE).toBe(22);
    expect(STATUS_RING_LARGE_SIZE).toBe(20);
    expect(STATUS_RING_LARGE_CENTER_DOT_SIZE).toBe(10);
    expect((STATUS_RING_LARGE_FRAME_SIZE - STATUS_RING_LARGE_SIZE) / 2).toBe(1);
    expect((STATUS_RING_LARGE_FRAME_SIZE - STATUS_RING_LARGE_CENTER_DOT_SIZE) / 2).toBe(6);
  });
});
