import { FAVICON_DEAD_OPACITY } from "@/lib/constants";
import type { FaviconState } from "./favicon-state-store";

const READY_GLYPH = "<path d='m6 8 4 4-4 4M12 16h6'/>";
const RUNNING_GLYPH = [
  "<circle cx='7' cy='12' r='1.5' fill='currentColor' stroke='none'/>",
  "<circle cx='12' cy='12' r='1.5' fill='currentColor' stroke='none'/>",
  "<circle cx='17' cy='12' r='1.5' fill='currentColor' stroke='none'/>",
].join("");

const FILL_FOR_STATE: Record<FaviconState, string> = {
  ready: "hsl(220 8% 46%)",
  running: "hsl(45 93% 47%)",
  notified: "hsl(220 8% 46%)",
  dead: "hsl(0 72% 50%)",
};

const INK_FOR_STATE: Record<FaviconState, string> = {
  ready: "hsl(220 10% 16%)",
  running: "hsl(45 90% 12%)",
  notified: "hsl(220 10% 16%)",
  dead: "hsl(0 80% 12%)",
};

const GLYPH_FOR_STATE: Record<FaviconState, string> = {
  ready: READY_GLYPH,
  running: RUNNING_GLYPH,
  notified: READY_GLYPH,
  dead: READY_GLYPH,
};

const BADGE_GLYPH =
  "<circle cx='19' cy='7' r='3.5' fill='hsl(0 72% 50%)' stroke='white' stroke-width='1.5'/>";

const HAS_BADGE: Record<FaviconState, boolean> = {
  ready: false,
  running: false,
  notified: true,
  dead: false,
};

export const buildFaviconSvg = (state: FaviconState): string => {
  const fill = FILL_FOR_STATE[state];
  const ink = INK_FOR_STATE[state];
  const glyph = GLYPH_FOR_STATE[state];
  const badge = HAS_BADGE[state] ? BADGE_GLYPH : "";
  const opacity = state === "dead" ? FAVICON_DEAD_OPACITY : 1;
  return [
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' color='${ink}' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' opacity='${opacity}'>`,
    `<rect x='2' y='4' width='20' height='16' rx='2' fill='${fill}'/>`,
    glyph,
    badge,
    "</svg>",
  ].join("");
};
