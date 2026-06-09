import { LOCAL_FONT_ID } from "@/lib/constants";
import { escapeCssFontFamily } from "@/utils/escape-css-font-family";

type TerminalFontSource = "fontsource" | "google" | "local";

export interface TerminalFont {
  id: string;
  name: string;
  family: string;
  source: TerminalFontSource;
}

const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const NERD_FONT_FAMILY = '"Symbols Nerd Font"';

const buildFamily = (primary: string): string =>
  `"${escapeCssFontFamily(primary)}", ${NERD_FONT_FAMILY}, ${MONO_FALLBACK}`;

export const buildLocalTerminalFont = (family: string): TerminalFont => ({
  id: LOCAL_FONT_ID,
  name: family,
  family: buildFamily(family),
  source: "local",
});

const buildStaticFont = (id: string, name: string, source: TerminalFontSource): TerminalFont => ({
  id,
  name,
  family: buildFamily(name),
  source,
});

const GEIST_MONO: TerminalFont = buildStaticFont("geist-mono", "Geist Mono", "fontsource");
const JETBRAINS_MONO: TerminalFont = buildStaticFont("jetbrains-mono", "JetBrains Mono", "google");
const FIRA_CODE: TerminalFont = buildStaticFont("fira-code", "Fira Code", "google");
const IBM_PLEX_MONO: TerminalFont = buildStaticFont("ibm-plex-mono", "IBM Plex Mono", "google");
const SOURCE_CODE_PRO: TerminalFont = buildStaticFont(
  "source-code-pro",
  "Source Code Pro",
  "google",
);
const ROBOTO_MONO: TerminalFont = buildStaticFont("roboto-mono", "Roboto Mono", "google");
const DM_MONO: TerminalFont = buildStaticFont("dm-mono", "DM Mono", "google");
const INCONSOLATA: TerminalFont = buildStaticFont("inconsolata", "Inconsolata", "google");
const SPACE_MONO: TerminalFont = buildStaticFont("space-mono", "Space Mono", "google");
const UBUNTU_MONO: TerminalFont = buildStaticFont("ubuntu-mono", "Ubuntu Mono", "google");
const ANONYMOUS_PRO: TerminalFont = buildStaticFont("anonymous-pro", "Anonymous Pro", "google");

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

export const findTerminalFontById = (
  id: string | null | undefined,
  localFontFamily?: string | null,
): TerminalFont => {
  if (id === LOCAL_FONT_ID && localFontFamily) return buildLocalTerminalFont(localFontFamily);
  if (!id) return GEIST_MONO;
  return TERMINAL_FONTS.find((font) => font.id === id) ?? GEIST_MONO;
};

export const buildGoogleFontsStylesheetHref = (): string => {
  const googleFonts = TERMINAL_FONTS.filter((font) => font.source === "google");
  if (googleFonts.length === 0) return "";
  const familyParams = googleFonts
    .map((font) => `family=${font.name.replace(/ /g, "+")}:wght@400;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${familyParams}&display=swap`;
};
