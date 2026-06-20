import {
  FONT_FACE_LOAD_POLL_INTERVAL_MS,
  FONT_FACE_LOAD_TIMEOUT_MS,
  FONT_LOAD_PROBE_PX,
} from "@/lib/constants";
import type { TerminalFont } from "@/lib/terminal-fonts";

const NERD_FONT_FAMILY = "Symbols Nerd Font";
const NERD_FONT_PROBE_CHARS = "\uE000\uE0A0\uE0B0\uE5FA\uF000";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isWeightCovered = (faceWeight: string, targetWeight: string): boolean => {
  const parts = faceWeight.split(/\s+/).map(Number);
  if (parts.length !== 2 || Number.isNaN(parts[1])) {
    return String(parts[0]) === targetWeight;
  }
  const [min, max] = parts;
  const target = Number(targetWeight);
  return target >= min && target <= max;
};

const hasLoadedFontFace = (family: string, weight: string): boolean => {
  try {
    for (const face of document.fonts) {
      if (
        face.status === "loaded" &&
        face.family.replace(/["']/g, "") === family &&
        isWeightCovered(String(face.weight), weight)
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
};

const canInspectFontFaces = (): boolean =>
  typeof document.fonts[Symbol.iterator] === "function";

const loadFontFaceUntilReady = async (
  fontString: string,
  family: string,
  weight: string,
  probeChars?: string,
): Promise<void> => {
  if (!canInspectFontFaces()) {
    try {
      await document.fonts.load(fontString, probeChars);
    } catch {
      /* ignore load failures in environments without a real FontFaceSet */
    }
    return;
  }

  const deadline = Date.now() + FONT_FACE_LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await document.fonts.load(fontString, probeChars);
      if (hasLoadedFontFace(family, weight)) return;
    } catch {
      return;
    }
    await delay(FONT_FACE_LOAD_POLL_INTERVAL_MS);
  }
};

export const awaitFontReady = async (font: TerminalFont): Promise<void> => {
  if (typeof document === "undefined") return;
  if (!font.name) return;
  try {
    await document.fonts.ready;
    await Promise.all([
      loadFontFaceUntilReady(
        `${FONT_LOAD_PROBE_PX}px "${font.name}"`,
        font.name,
        "400",
      ),
      loadFontFaceUntilReady(
        `bold ${FONT_LOAD_PROBE_PX}px "${font.name}"`,
        font.name,
        "700",
      ),
      loadFontFaceUntilReady(
        `${FONT_LOAD_PROBE_PX}px "${NERD_FONT_FAMILY}"`,
        NERD_FONT_FAMILY,
        "400",
        NERD_FONT_PROBE_CHARS,
      ),
      loadFontFaceUntilReady(
        `bold ${FONT_LOAD_PROBE_PX}px "${NERD_FONT_FAMILY}"`,
        NERD_FONT_FAMILY,
        "700",
        NERD_FONT_PROBE_CHARS,
      ),
    ]);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[localterm] failed to load font "${font.name}":`, error);
    }
  }
};
