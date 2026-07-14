import {
  DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT,
  KEYBOARD_HEIGHT_SCALE_MAX_PERCENT,
  KEYBOARD_HEIGHT_SCALE_MIN_PERCENT,
  KEYBOARD_HEIGHT_SCALE_STEP_PERCENT,
} from "@/lib/constants";

export const clampKeyboardHeightScale = (heightScalePercent: number): number => {
  if (!Number.isFinite(heightScalePercent)) return DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT;
  const steppedHeightScale =
    Math.round(heightScalePercent / KEYBOARD_HEIGHT_SCALE_STEP_PERCENT) *
    KEYBOARD_HEIGHT_SCALE_STEP_PERCENT;
  return Math.min(
    KEYBOARD_HEIGHT_SCALE_MAX_PERCENT,
    Math.max(KEYBOARD_HEIGHT_SCALE_MIN_PERCENT, steppedHeightScale),
  );
};
