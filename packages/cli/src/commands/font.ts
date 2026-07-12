import kleur from "kleur";
import {
  BUILTIN_FONT_IDS,
  CUSTOM_FONT_ID,
  TERMINAL_FONTS,
  findTerminalFontById,
} from "@monotykamary/localterm-server/fonts";
import {
  daemonBaseUrl,
  daemonFetch,
  reportApiError,
  reportDaemonDown,
} from "../utils/daemon-api.js";

interface FontsState {
  activeFontId: string;
  customFontFamily: string;
  nerdFontEnabled: boolean;
  ligaturesEnabled: boolean;
}

const fetchFonts = async (): Promise<FontsState | null> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    return null;
  }
  const response = await daemonFetch(`${base}/fonts`);
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    return null;
  }
  return (await response.json()) as FontsState;
};

// `localterm font list` — every selectable font (the built-ins + the "custom"
// entry) with the active one marked, plus the custom family + the Nerd Font /
// ligatures toggles as a footer so the user sees the full font state at once.
const runList = async (): Promise<void> => {
  const state = await fetchFonts();
  if (!state) {
    process.exitCode = 1;
    return;
  }
  const rows: { id: string; name: string; source: string }[] = [
    ...TERMINAL_FONTS.map((font) => ({
      id: font.id,
      name: font.name,
      source: "built-in",
    })),
    { id: CUSTOM_FONT_ID, name: "Custom…", source: "custom" },
  ];
  const idWidth = Math.max(2, ...rows.map((row) => row.id.length));
  const nameWidth = Math.max(4, ...rows.map((row) => row.name.length));
  console.log(`  ${"ID".padEnd(idWidth)}  ${"NAME".padEnd(nameWidth)}  SOURCE`);
  console.log(`${"─".repeat(2)}  ${"─".repeat(idWidth)}  ${"─".repeat(nameWidth)}  ────────`);
  for (const row of rows) {
    const marker = row.id === state.activeFontId ? `${kleur.green("*")}` : " ";
    const id = kleur.cyan(row.id.padEnd(idWidth));
    const name = row.name.padEnd(nameWidth);
    console.log(`${marker}  ${id}  ${name}  ${kleur.dim(row.source)}`);
  }
  const familyLabel = state.customFontFamily || kleur.dim("(unset — bundled default)");
  console.log(kleur.dim(`\n  custom family: ${familyLabel}`));
  console.log(
    kleur.dim(
      `  nerd font: ${state.nerdFontEnabled ? "on" : "off"}   ligatures: ${
        state.ligaturesEnabled ? "on" : "off"
      }`,
    ),
  );
};

// `localterm font get` — print the active font id + name, the custom family
// when the active font is "custom", and the toggle states.
const runGet = async (): Promise<void> => {
  const state = await fetchFonts();
  if (!state) {
    process.exitCode = 1;
    return;
  }
  const name = findTerminalFontById(state.activeFontId).name;
  const familySuffix =
    state.activeFontId === CUSTOM_FONT_ID && state.customFontFamily
      ? kleur.dim(`  (custom: ${state.customFontFamily})`)
      : "";
  console.log(`${state.activeFontId}${kleur.dim(`  (${name})`)}${familySuffix}`);
  console.log(
    kleur.dim(
      `  nerd font: ${state.nerdFontEnabled ? "on" : "off"}   ligatures: ${
        state.ligaturesEnabled ? "on" : "off"
      }`,
    ),
  );
};

// PUT a partial font update; returns the reconciled state or null on failure.
const putFonts = async (patch: Partial<FontsState>): Promise<FontsState | null> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    return null;
  }
  const response = await daemonFetch(`${base}/fonts`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    return null;
  }
  return (await response.json()) as FontsState;
};

const printActive = (state: FontsState): void => {
  const name = findTerminalFontById(state.activeFontId).name;
  console.log(kleur.green(`✓ active font: ${state.activeFontId}${name ? ` (${name})` : ""}`));
};

// `localterm font set <id>` — make a font active (a built-in id or "custom").
// The daemon validates the id against the built-ins, so a typo is rejected
// instead of silently falling back to the default family.
const runSet = async (id: string): Promise<void> => {
  if (!BUILTIN_FONT_IDS.includes(id)) {
    console.log(kleur.red(`✗ unknown font id '${id}'. try \`localterm font list\`.`));
    process.exitCode = 1;
    return;
  }
  const state = await putFonts({ activeFontId: id });
  if (!state) {
    process.exitCode = 1;
    return;
  }
  printActive(state);
};

// `localterm font family <name>` — set the custom font family (a
// system-installed family the OS resolves, e.g. "JetBrainsMono Nerd Font
// Mono") AND activate the "custom" font in one step, since setting a family
// you won't use is pointless. A blank name clears the family (the custom font
// then falls back to the bundled default).
const runFamily = async (name: string): Promise<void> => {
  const state = await putFonts({ customFontFamily: name, activeFontId: CUSTOM_FONT_ID });
  if (!state) {
    process.exitCode = 1;
    return;
  }
  const label = state.customFontFamily || kleur.dim("(bundled default)");
  console.log(kleur.green(`✓ custom font: ${label}`));
};

const parseToggle = (value: string): boolean | null => {
  if (value === "on") return true;
  if (value === "off") return false;
  return null;
};

// `localterm font nerd-font <on|off>` — toggle the bundled Nerd Font symbol
// layer over the selected font.
const runNerdFont = async (value: string): Promise<void> => {
  const enabled = parseToggle(value);
  if (enabled === null) {
    console.log(kleur.red(`✗ expected 'on' or 'off', got '${value}'.`));
    process.exitCode = 1;
    return;
  }
  const state = await putFonts({ nerdFontEnabled: enabled });
  if (!state) {
    process.exitCode = 1;
    return;
  }
  console.log(kleur.green(`✓ nerd font: ${state.nerdFontEnabled ? "on" : "off"}`));
};

// `localterm font ligatures <on|off>` — toggle ligature joining (Fira Code
// etc.) on the rendered terminal.
const runLigatures = async (value: string): Promise<void> => {
  const enabled = parseToggle(value);
  if (enabled === null) {
    console.log(kleur.red(`✗ expected 'on' or 'off', got '${value}'.`));
    process.exitCode = 1;
    return;
  }
  const state = await putFonts({ ligaturesEnabled: enabled });
  if (!state) {
    process.exitCode = 1;
    return;
  }
  console.log(kleur.green(`✓ ligatures: ${state.ligaturesEnabled ? "on" : "off"}`));
};

export const runFontList = runList;
export const runFontGet = runGet;
export const runFontSet = runSet;
export const runFontFamily = runFamily;
export const runFontNerdFont = runNerdFont;
export const runFontLigatures = runLigatures;
