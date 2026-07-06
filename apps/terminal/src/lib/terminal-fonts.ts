import { escapeCssFontFamily } from "@/utils/escape-css-font-family";

type TerminalFontSource = "fontsource" | "custom";

export interface TerminalFont {
  id: string;
  name: string;
  family: string;
  source: TerminalFontSource;
}

const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const NERD_FONT_FAMILY = '"Symbols Nerd Font"';

const buildFamily = (primary: string, nerdEnabled: boolean): string =>
  `"${escapeCssFontFamily(primary)}"${nerdEnabled ? `, ${NERD_FONT_FAMILY}` : ""}, ${MONO_FALLBACK}`;

const buildStaticFont = (id: string, name: string): TerminalFont => ({
  id,
  name,
  family: buildFamily(name, true),
  source: "fontsource",
});

const GEIST_MONO: TerminalFont = buildStaticFont("geist-mono", "Geist Mono");
const JETBRAINS_MONO: TerminalFont = buildStaticFont("jetbrains-mono", "JetBrains Mono");
const FIRA_CODE: TerminalFont = buildStaticFont("fira-code", "Fira Code");
const IBM_PLEX_MONO: TerminalFont = buildStaticFont("ibm-plex-mono", "IBM Plex Mono");
const SOURCE_CODE_PRO: TerminalFont = buildStaticFont("source-code-pro", "Source Code Pro");
const ROBOTO_MONO: TerminalFont = buildStaticFont("roboto-mono", "Roboto Mono");
const DM_MONO: TerminalFont = buildStaticFont("dm-mono", "DM Mono");
const INCONSOLATA: TerminalFont = buildStaticFont("inconsolata", "Inconsolata");
const SPACE_MONO: TerminalFont = buildStaticFont("space-mono", "Space Mono");
const UBUNTU_MONO: TerminalFont = buildStaticFont("ubuntu-mono", "Ubuntu Mono");
const ANONYMOUS_PRO: TerminalFont = buildStaticFont("anonymous-pro", "Anonymous Pro");

export const TERMINAL_FONTS: TerminalFont[] = [
  GEIST_MONO,
  ANONYMOUS_PRO,
  DM_MONO,
  FIRA_CODE,
  IBM_PLEX_MONO,
  INCONSOLATA,
  JETBRAINS_MONO,
  ROBOTO_MONO,
  SOURCE_CODE_PRO,
  SPACE_MONO,
  UBUNTU_MONO,
];

export const DEFAULT_TERMINAL_FONT_ID: string = GEIST_MONO.id;

// A user-entered font family (a system-installed Nerd Font such as
// "JetBrainsMono Nerd Font Mono" or "MesloLGS NF", or any other monospace the
// OS resolves). Distinct from the built-in fontsource fonts so the picker can
// offer it as a "Custom…" option; the family is built the same way (escaped
// primary + optional Nerd Font symbols + the generic monospace fallback), and
// the browser resolves the primary against the host's installed fonts
// (fontconfig on Linux, the system font stack elsewhere) — no bundled asset,
// no network fetch. Empty name falls back to the default so a blank field
// never produces a bare fallback chain.
export const CUSTOM_FONT_ID = "custom";

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
  return TERMINAL_FONTS.find((font) => font.id === id) ?? GEIST_MONO;
};

export const familyForFont = (font: TerminalFont, nerdEnabled: boolean): string =>
  buildFamily(font.name, nerdEnabled);
