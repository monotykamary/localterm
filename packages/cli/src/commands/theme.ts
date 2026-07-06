import { readFileSync } from "node:fs";
import { basename } from "node:path";
import kleur from "kleur";
import {
  AUTO_THEME_ID,
  TERMINAL_THEMES,
  type TerminalTheme,
} from "@monotykamary/localterm-server/themes";
import {
  daemonBaseUrl,
  daemonFetch,
  reportApiError,
  reportDaemonDown,
} from "../utils/daemon-api.js";

interface ThemesState {
  activeThemeId: string;
  customThemes: TerminalTheme[];
}

const fetchThemes = async (): Promise<ThemesState | null> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    return null;
  }
  const response = await daemonFetch(`${base}/themes`);
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    return null;
  }
  return (await response.json()) as ThemesState;
};

// The selectable id → display-name table: the "auto" pseudo-theme, the built-ins
// (from the shared catalog), and the user's imported custom themes. The active
// theme is resolved against all three so `list`/`get` print a friendly name
// instead of a bare id.
const buildNameLookup = (customThemes: readonly TerminalTheme[]): Map<string, string> => {
  const names = new Map<string, string>();
  names.set(AUTO_THEME_ID, "Auto (system)");
  for (const theme of TERMINAL_THEMES) names.set(theme.id, theme.name);
  for (const theme of customThemes) names.set(theme.id, theme.name);
  return names;
};

// `localterm theme list` — every selectable theme (built-ins + imported customs)
// with the active one marked, so the user knows what they can `theme set`.
const runList = async (): Promise<void> => {
  const state = await fetchThemes();
  if (!state) {
    process.exitCode = 1;
    return;
  }
  const rows: { id: string; name: string; source: string }[] = [
    { id: AUTO_THEME_ID, name: "Auto (system)", source: "built-in" },
    ...TERMINAL_THEMES.map((theme) => ({
      id: theme.id,
      name: theme.name,
      source: "built-in",
    })),
    ...state.customThemes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      source: theme.source,
    })),
  ];
  const idWidth = Math.max(2, ...rows.map((row) => row.id.length));
  const nameWidth = Math.max(4, ...rows.map((row) => row.name.length));
  console.log(`${"  ".padEnd(2)}  ${"ID".padEnd(idWidth)}  ${"NAME".padEnd(nameWidth)}  SOURCE`);
  console.log(`${"─".repeat(2)}  ${"─".repeat(idWidth)}  ${"─".repeat(nameWidth)}  ────────`);
  for (const row of rows) {
    const marker = row.id === state.activeThemeId ? `${kleur.green("*")}` : " ";
    const id = kleur.cyan(row.id.padEnd(idWidth));
    const name = row.name.padEnd(nameWidth);
    console.log(`${marker}  ${id}  ${name}  ${kleur.dim(row.source)}`);
  }
};

// `localterm theme get` — print the active theme id and its friendly name.
const runGet = async (): Promise<void> => {
  const state = await fetchThemes();
  if (!state) {
    process.exitCode = 1;
    return;
  }
  const name = buildNameLookup(state.customThemes).get(state.activeThemeId);
  console.log(`${state.activeThemeId}${name ? kleur.dim(`  (${name})`) : ""}`);
};

// `localterm theme import <file>` — parse + store a theme from a file (JSON
// `{name, colors}` / bare colors, or an iTerm `.itermcolors` plist). The daemon
// parses — one parser, shared with the browser upload — so a malformed file
// reports a stable error. Prints the new theme's id (use it with `theme set`).
const runImport = async (filePath: string): Promise<void> => {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    console.log(kleur.red(`✗ couldn't read '${filePath}'.`));
    process.exitCode = 1;
    return;
  }
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await daemonFetch(`${base}/themes/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, filename: basename(filePath) }),
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  const body = (await response.json()) as { theme: TerminalTheme };
  console.log(kleur.green(`✓ imported '${body.theme.name}'`));
  console.log(kleur.cyan(`  id: ${body.theme.id}`));
  console.log(kleur.dim(`  set it with: localterm theme set ${body.theme.id}`));
};

// `localterm theme set <id>` — make a theme active (a built-in id, "auto", or a
// custom theme id). The daemon validates the id against the built-ins + the
// stored customs, so a typo is rejected instead of silently falling back.
const runSet = async (id: string): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await daemonFetch(`${base}/themes/active`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  const body = (await response.json()) as { activeThemeId: string };
  const state = await fetchThemes();
  const name = state ? buildNameLookup(state.customThemes).get(body.activeThemeId) : undefined;
  console.log(kleur.green(`✓ active theme: ${body.activeThemeId}${name ? ` (${name})` : ""}`));
};

// `localterm theme delete <id>` — remove an imported custom theme. Deleting the
// active custom theme resets the active id to the default; the daemon reports
// the new active id so the CLI can surface it.
const runDelete = async (id: string): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await daemonFetch(`${base}/themes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  console.log(kleur.green(`✓ deleted theme '${id}'`));
};

export const runThemeList = runList;
export const runThemeGet = runGet;
export const runThemeImport = runImport;
export const runThemeSet = runSet;
export const runThemeDelete = runDelete;
