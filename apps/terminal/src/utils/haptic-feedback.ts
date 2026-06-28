// navigator.vibrate is unsupported on iOS Safari and on desktop browsers
// without a vibrator; the guard keeps this a silent no-op there instead of a
// TypeError, so callers can fire it unconditionally across platforms.
export const triggerHapticFeedback = (durationMs: number): void => {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  navigator.vibrate(durationMs);
};
