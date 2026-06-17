import {
  FONT_FACE_LOAD_POLL_MS,
  FONT_FACE_LOAD_TIMEOUT_MS,
  FONT_LOAD_PROBE_PX,
} from "@/lib/constants";
import type { TerminalFont } from "@/lib/terminal-fonts";

const NERD_FONT_FAMILY = "Symbols Nerd Font";
const NERD_FONT_PROBE_CHARS = "\uE000\uE0A0\uE0B0\uE5FA\uF000";

const stripQuotes = (family: string): string => family.replace(/["']/g, "");

// document.fonts.load() resolves with an empty array (no error) when the
// @font-face is not parsed yet, and document.fonts.ready resolves immediately
// when nothing is loading. On a cold reload both resolve before the real face
// is decoded, so the caller clears the glyph atlas on an unloaded face and
// re-rasterizes regular text at a fallback weight (looks bold). Polling the
// FontFace status is the only reliable "really loaded" signal — check() returns
// true even with no @font-face declared because fallback can render the text.
const isFontFaceLoaded = (family: string, weight: string): boolean => {
  for (const face of document.fonts) {
    if (
      stripQuotes(face.family) === stripQuotes(family) &&
      String(face.weight) === String(weight) &&
      face.status === "loaded"
    ) {
      return true;
    }
  }
  return false;
};

const awaitFontFaceLoaded = async (
  family: string,
  weight: string,
  probe: string,
): Promise<void> => {
  const deadline = performance.now() + FONT_FACE_LOAD_TIMEOUT_MS;
  while (performance.now() < deadline) {
    if (isFontFaceLoaded(family, weight)) return;
    try {
      await document.fonts.load(probe);
    } catch {
      break;
    }
    if (isFontFaceLoaded(family, weight)) return;
    await new Promise((resolve) => setTimeout(resolve, FONT_FACE_LOAD_POLL_MS));
  }
};

export const awaitFontReady = async (font: TerminalFont): Promise<void> => {
  if (typeof document === "undefined") return;
  if (!font.name) return;
  const regularProbe = `${FONT_LOAD_PROBE_PX}px "${font.name}"`;
  const boldProbe = `bold ${FONT_LOAD_PROBE_PX}px "${font.name}"`;
  try {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load(regularProbe),
      document.fonts.load(boldProbe),
      document.fonts.load(`${FONT_LOAD_PROBE_PX}px "${NERD_FONT_FAMILY}"`, NERD_FONT_PROBE_CHARS),
      document.fonts.load(
        `bold ${FONT_LOAD_PROBE_PX}px "${NERD_FONT_FAMILY}"`,
        NERD_FONT_PROBE_CHARS,
      ),
    ]);
    await awaitFontFaceLoaded(font.name, "400", regularProbe);
    await awaitFontFaceLoaded(font.name, "700", boldProbe);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[localterm] failed to load font "${font.name}":`, error);
    }
  }
};
