import {
  DEFAULT_TERMINAL_PADDING_X_PX,
  DEFAULT_TERMINAL_PADDING_Y_PX,
  TERMINAL_PADDING_MAX_PX,
  TERMINAL_PADDING_MIN_PX,
  TERMINAL_PADDING_STEP_PX,
} from "@/lib/constants";

const STEP_PRECISION_FACTOR = 1 / TERMINAL_PADDING_STEP_PX;

const roundToStep = (value: number): number =>
  Math.round(value * STEP_PRECISION_FACTOR) / STEP_PRECISION_FACTOR;

export const clampTerminalPaddingX = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_PADDING_X_PX;
  const snapped = roundToStep(value);
  if (snapped < TERMINAL_PADDING_MIN_PX) return TERMINAL_PADDING_MIN_PX;
  if (snapped > TERMINAL_PADDING_MAX_PX) return TERMINAL_PADDING_MAX_PX;
  return snapped;
};

export const clampTerminalPaddingY = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_PADDING_Y_PX;
  const snapped = roundToStep(value);
  if (snapped < TERMINAL_PADDING_MIN_PX) return TERMINAL_PADDING_MIN_PX;
  if (snapped > TERMINAL_PADDING_MAX_PX) return TERMINAL_PADDING_MAX_PX;
  return snapped;
};
