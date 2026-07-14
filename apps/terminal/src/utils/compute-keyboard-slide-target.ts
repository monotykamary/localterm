import type { KeyGlyph, SlideDirection } from "@/components/on-screen-keyboard/keyboard-layout";
import { ALL_SLIDE_DIRECTIONS } from "@/components/on-screen-keyboard/keyboard-layout";
import { KEYBOARD_SLIDE_DIRECTION_TOLERANCE_RAD } from "@/lib/constants";

export interface SlideTarget {
  readonly direction: SlideDirection;
  readonly glyph: KeyGlyph;
}

// Angle per slide direction in radians from +x (east), clockwise (y grows down)
// to match screen coordinates.
const SLIDE_DIRECTION_ANGLES: Record<SlideDirection, number> = {
  east: 0,
  southEast: Math.PI / 4,
  south: Math.PI / 2,
  southWest: (3 * Math.PI) / 4,
  west: Math.PI,
  northWest: -(3 * Math.PI) / 4,
  north: -Math.PI / 2,
  northEast: -Math.PI / 4,
};

// Picks the defined alternate whose angle is nearest to the slide vector, but
// only once the finger has moved past the threshold and is heading toward that
// alternate's corner. The angle gate leaves wrong-direction swipes available for
// drag correction instead of triggering a key's only alternate.
export const computeKeyboardSlideTarget = (
  deltaX: number,
  deltaY: number,
  threshold: number,
  alternates: Partial<Record<SlideDirection, KeyGlyph>>,
): SlideTarget | null => {
  const defined = ALL_SLIDE_DIRECTIONS.filter((direction) => alternates[direction] != null);
  if (defined.length === 0) return null;
  if (Math.hypot(deltaX, deltaY) < threshold) return null;
  const angle = Math.atan2(deltaY, deltaX);
  let nearestDirection = defined[0];
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (const direction of defined) {
    let delta = Math.abs(angle - SLIDE_DIRECTION_ANGLES[direction]);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearestDirection = direction;
    }
  }
  if (nearestDelta > KEYBOARD_SLIDE_DIRECTION_TOLERANCE_RAD) return null;
  const glyph = alternates[nearestDirection];
  return glyph == null ? null : { direction: nearestDirection, glyph };
};
