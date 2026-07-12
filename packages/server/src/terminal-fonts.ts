// The built-in terminal font catalog, shared by the daemon (storage +
// completion + the `localterm font` CLI) and the browser terminal app. Lives
// in the server package so every surface reads one source of truth — the
// browser's `apps/terminal/src/lib/terminal-fonts.ts` re-exports this and adds
// the CSS `family` string the xterm renderer needs (a browser-only concern;
// the daemon stores only the font id + the user-entered custom family name).

export type TerminalFontSource = "fontsource" | "custom";

export interface TerminalFont {
  id: string;
  name: string;
  source: TerminalFontSource;
}

const buildStaticFont = (id: string, name: string): TerminalFont => ({
  id,
  name,
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

// A pseudo-font id: not a real TerminalFont (no family) — the browser builds it
// on demand from the user-entered family name. Selectable like a built-in so
// the user can `font set custom` from the CLI; the family string is stored
// alongside the active id in ~/.localterm/fonts.json.
export const CUSTOM_FONT_ID = "custom";

// The set of ids a user can select as the active font: the built-ins plus the
// "custom" pseudo-id. Used by the daemon to validate PUT /api/fonts and to
// complete `font set`, and by the browser to recognize the custom entry.
export const BUILTIN_FONT_IDS: readonly string[] = [
  CUSTOM_FONT_ID,
  ...TERMINAL_FONTS.map((font) => font.id),
];

export const isBuiltinFontId = (id: string): boolean =>
  id === CUSTOM_FONT_ID || TERMINAL_FONTS.some((font) => font.id === id);

// Resolve a font id against the built-ins. The "custom" id resolves to a
// synthetic entry (the browser fills in the family; the daemon uses the id
// only for validation + display). An unknown id falls back to the default.
export const findTerminalFontById = (id: string | null | undefined): TerminalFont => {
  if (!id) return GEIST_MONO;
  if (id === CUSTOM_FONT_ID) return { id: CUSTOM_FONT_ID, name: "Custom", source: "custom" };
  return TERMINAL_FONTS.find((font) => font.id === id) ?? GEIST_MONO;
};
