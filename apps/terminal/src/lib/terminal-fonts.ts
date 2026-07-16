import { escapeCssFontFamily } from "@/utils/escape-css-font-family";
import {
  TERMINAL_FONTS as SERVER_TERMINAL_FONTS,
  DEFAULT_TERMINAL_FONT_ID,
  CUSTOM_FONT_ID,
  type TerminalFont as ServerTerminalFont,
} from "@monotykamary/localterm-server/fonts";

export { DEFAULT_TERMINAL_FONT_ID, CUSTOM_FONT_ID };

// The browser TerminalFont extends the shared catalog entry with the CSS
// `family` string xterm renders with — a browser-only concern the daemon
// never stores (it keeps the font id + the user-entered family name in
// ~/.localterm/fonts.json, shared with the `localterm font` CLI).
export interface TerminalFont extends ServerTerminalFont {
  family: string;
}

const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const NERD_FONT_FAMILY = '"Symbols Nerd Font"';

const buildFamily = (primary: string, nerdEnabled: boolean): string =>
  `"${escapeCssFontFamily(primary)}"${nerdEnabled ? `, ${NERD_FONT_FAMILY}` : ""}, ${MONO_FALLBACK}`;

const withFamily = (font: ServerTerminalFont): TerminalFont => ({
  ...font,
  family: buildFamily(font.name, true),
});

export const TERMINAL_FONTS: TerminalFont[] = SERVER_TERMINAL_FONTS.map(withFamily);

const GEIST_MONO: TerminalFont =
  TERMINAL_FONTS.find((font) => font.id === DEFAULT_TERMINAL_FONT_ID) ?? TERMINAL_FONTS[0];

// A user-entered font family (a system-installed Nerd Font such as
// "JetBrainsMono Nerd Font Mono" or "MesloLGS NF", or any other monospace the
// OS resolves). Distinct from the built-in fontsource fonts so the picker can
// offer it as a "Custom…" option; the family is built the same way (escaped
// primary + optional Nerd Font symbols + the generic monospace fallback), and
// the browser resolves the primary against the host's installed fonts
// (fontconfig on Linux, the system font stack elsewhere) — no bundled asset,
// no network fetch. Empty name falls back to the default so a blank field
// never produces a bare fallback chain.
export const buildCustomTerminalFont = (familyName: string): TerminalFont => {
  const trimmed = familyName.trim();
  const primary = trimmed || GEIST_MONO.name;
  return {
    id: CUSTOM_FONT_ID,
    name: trimmed || "Custom",
    family: buildFamily(primary, true),
    source: "custom",
  };
};

export const findTerminalFontById = (id: string | null | undefined): TerminalFont => {
  if (!id) return GEIST_MONO;
  if (id === CUSTOM_FONT_ID) return buildCustomTerminalFont("");
  return TERMINAL_FONTS.find((font) => font.id === id) ?? GEIST_MONO;
};

export const familyForFont = (font: TerminalFont, nerdEnabled: boolean): string =>
  buildFamily(font.name, nerdEnabled);
