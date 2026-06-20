import { FONT_LOAD_PROBE_PX } from "@/lib/constants";
import type { TerminalFont } from "@/lib/terminal-fonts";

const NERD_FONT_FAMILY = "Symbols Nerd Font";
const NERD_FONT_PROBE_CHARS = "\uE000\uE0A0\uE0B0\uE5FA\uF000";

export const awaitFontReady = async (font: TerminalFont): Promise<void> => {
  if (typeof document === "undefined") return;
  if (!font.name) return;
  try {
    await document.fonts.ready;
    const pending = [
      document.fonts.load(`${FONT_LOAD_PROBE_PX}px "${font.name}"`),
      document.fonts.load(`bold ${FONT_LOAD_PROBE_PX}px "${font.name}"`),
      document.fonts.load(`${FONT_LOAD_PROBE_PX}px "${NERD_FONT_FAMILY}"`, NERD_FONT_PROBE_CHARS),
      document.fonts.load(
        `bold ${FONT_LOAD_PROBE_PX}px "${NERD_FONT_FAMILY}"`,
        NERD_FONT_PROBE_CHARS,
      ),
    ];
    await Promise.all(pending);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[localterm] failed to load font "${font.name}":`, error);
    }
  }
};
