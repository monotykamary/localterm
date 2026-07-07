import type { SessionListItem } from "@monotykamary/localterm-server/protocol";

// The golden angle — advancing by it each step spaces any N hues near-optimally
// around the wheel, so two profiles can never collapse to the same hue the way
// a per-id hash can (two uuids once hashed to ~12° apart: indistinguishable
// purples, making a third client invisible). Colors are ranked by index across
// the picker, not derived from each id's bits, so they depend only on how many
// profiles are visible.
const GOLDEN_ANGLE_DEG = 137.508;
// Start the sequence at blue (calm, and distinct from a red/warning read); the
// second profile lands ~137° away (pink), the third ~115° (green), and so on.
const BASE_HUE_DEG = 200;
const DOT_SATURATION_PCT = 55;
const DOT_LIGHTNESS_PCT = 55;

// One CSS color per non-self, non-unknown browser profile appearing anywhere
// in the picker's loaded sessions. Profiles are sorted for a deterministic rank
// so the same set keeps the same colors across polls (no flicker in steady
// state); when a new profile joins, later ranks shift but every color stays
// well-separated from the others. The picker's own profile (foreground) and
// back-compat clients with no id ("") are excluded — they render with theme
// classes, not this map.
export const buildPeerColorMap = (
  sessions: readonly SessionListItem[],
  selfWindowId: string,
): Map<string, string> => {
  const windowIds = new Set<string>();
  for (const session of sessions) {
    for (const profile of session.clientProfiles ?? []) {
      const windowId = profile.windowId;
      if (windowId === "" || windowId === selfWindowId) continue;
      windowIds.add(windowId);
    }
  }
  const colors = new Map<string, string>();
  [...windowIds].sort().forEach((windowId, index) => {
    const hue = (BASE_HUE_DEG + index * GOLDEN_ANGLE_DEG) % 360;
    colors.set(windowId, `hsl(${hue} ${DOT_SATURATION_PCT}% ${DOT_LIGHTNESS_PCT}%)`);
  });
  return colors;
};
