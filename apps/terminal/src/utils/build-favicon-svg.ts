import { FAVICON_DEAD_OPACITY } from "@/lib/constants";
import type { FaviconState } from "./favicon-state-store";

const READY_GLYPH = "<path d='m6 8 4 4-4 4M12 16h6'/>";
const RUNNING_GLYPH = [
  "<circle cx='7' cy='12' r='1.5' fill='currentColor' stroke='none'/>",
  "<circle cx='12' cy='12' r='1.5' fill='currentColor' stroke='none'/>",
  "<circle cx='17' cy='12' r='1.5' fill='currentColor' stroke='none'/>",
].join("");

const FILL_FOR_STATE: Record<FaviconState, string> = {
  ready: "hsl(142 72% 45%)",
  running: "hsl(45 93% 47%)",
  dead: "hsl(0 72% 50%)",
};

const INK_FOR_STATE: Record<FaviconState, string> = {
  ready: "hsl(142 85% 12%)",
  running: "hsl(45 90% 12%)",
  dead: "hsl(0 80% 12%)",
};

const GLYPH_FOR_STATE: Record<FaviconState, string> = {
  ready: READY_GLYPH,
  running: RUNNING_GLYPH,
  dead: READY_GLYPH,
};

export const buildFaviconSvg = (state: FaviconState): string => {
  const fill = FILL_FOR_STATE[state];
  const ink = INK_FOR_STATE[state];
  const glyph = GLYPH_FOR_STATE[state];
  const opacity = state === "dead" ? FAVICON_DEAD_OPACITY : 1;
  return [
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' color='${ink}' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' opacity='${opacity}'>`,
    `<rect x='2' y='4' width='20' height='16' rx='2' fill='${fill}'/>`,
    glyph,
    "</svg>",
  ].join("");
};
