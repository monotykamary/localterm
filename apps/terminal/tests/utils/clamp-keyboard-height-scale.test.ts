import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
  KEYBOARD_HEIGHT_SCALE_MAX_PERCENT,
  KEYBOARD_HEIGHT_SCALE_MIN_PERCENT,
} from "../../src/lib/constants";
import { clampKeyboardHeightScale } from "../../src/utils/clamp-keyboard-height-scale";

describe("clampKeyboardHeightScale", () => {
  it("keeps valid step values", () => {
    expect(clampKeyboardHeightScale(DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT)).toBe(
      DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
    );
    expect(clampKeyboardHeightScale(KEYBOARD_HEIGHT_SCALE_MIN_PERCENT)).toBe(
      KEYBOARD_HEIGHT_SCALE_MIN_PERCENT,
    );
    expect(clampKeyboardHeightScale(KEYBOARD_HEIGHT_SCALE_MAX_PERCENT)).toBe(
      KEYBOARD_HEIGHT_SCALE_MAX_PERCENT,
    );
  });

  it("rounds to the nearest supported step", () => {
    expect(clampKeyboardHeightScale(82)).toBe(80);
    expect(clampKeyboardHeightScale(83)).toBe(85);
  });

  it("clamps values to the supported range", () => {
    expect(clampKeyboardHeightScale(1)).toBe(KEYBOARD_HEIGHT_SCALE_MIN_PERCENT);
    expect(clampKeyboardHeightScale(999)).toBe(KEYBOARD_HEIGHT_SCALE_MAX_PERCENT);
  });

  it("falls back to the compact default for non-finite values", () => {
    expect(clampKeyboardHeightScale(Number.NaN)).toBe(DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT);
    expect(clampKeyboardHeightScale(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
    );
  });
});
