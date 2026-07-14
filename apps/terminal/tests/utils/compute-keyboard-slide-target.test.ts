import { describe, expect, it } from "vite-plus/test";
import type {
  KeyGlyph,
  SlideDirection,
} from "../../src/components/on-screen-keyboard/keyboard-layout";
import { KEYBOARD_SLIDE_THRESHOLD_PX } from "../../src/lib/constants";
import { computeKeyboardSlideTarget } from "../../src/utils/compute-keyboard-slide-target";

const dismissGlyph: KeyGlyph = {
  label: "hide",
  output: "",
  action: "dismiss",
};

const alternates: Partial<Record<SlideDirection, KeyGlyph>> = { southEast: dismissGlyph };

describe("computeKeyboardSlideTarget", () => {
  it("selects a corner action when the swipe heads toward that corner", () => {
    expect(
      computeKeyboardSlideTarget(
        KEYBOARD_SLIDE_THRESHOLD_PX,
        KEYBOARD_SLIDE_THRESHOLD_PX,
        KEYBOARD_SLIDE_THRESHOLD_PX,
        alternates,
      ),
    ).toEqual({ direction: "southEast", glyph: dismissGlyph });
  });

  it("does not select the only alternate for a swipe in the wrong direction", () => {
    expect(
      computeKeyboardSlideTarget(
        -KEYBOARD_SLIDE_THRESHOLD_PX,
        0,
        KEYBOARD_SLIDE_THRESHOLD_PX,
        alternates,
      ),
    ).toBeNull();
  });

  it("ignores movement below the slide threshold", () => {
    expect(computeKeyboardSlideTarget(1, 1, KEYBOARD_SLIDE_THRESHOLD_PX, alternates)).toBeNull();
  });
});
