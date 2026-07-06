import fs from "node:fs";
import path from "node:path";
import { MAX_CUSTOM_THEMES, THEMES_FILE_VERSION } from "./constants.js";
import { themesFileSchema } from "./schemas.js";
import {
  DEFAULT_TERMINAL_THEME_ID,
  isBuiltinThemeId,
  type TerminalTheme,
} from "./terminal-themes.js";

interface ThemeStoreOptions {
  filePath: string;
}

// Owns the persisted terminal theme state in ~/.localterm/themes.json: the
// active theme id plus the user's imported custom themes. Mirrors SecretStore's
// load/persist shape (zod-validated read, atomic tmp+rename write). The active
// id is sanitized on load — a stale id left by a deleted custom theme (or a
// hand-edited file) falls back to the default rather than rendering nothing.
export class ThemeStore {
  private activeThemeId: string = DEFAULT_TERMINAL_THEME_ID;
  private customThemes: TerminalTheme[] = [];
  private initialized = false;
  private readonly filePath: string;

  constructor(options: ThemeStoreOptions) {
    this.filePath = options.filePath;
    this.load();
  }

  // True once ~/.localterm/themes.json has been written (or loaded). The browser
  // uses it as a one-time migration gate: on first contact with an
  // uninitialized store it pushes its legacy localStorage themes (preserving
  // their ids) so an upgrade doesn't lose the user's imported themes / active
  // selection. Once initialized, the store is the source of truth.
  isInitialized(): boolean {
    return this.initialized;
  }

  list(): TerminalTheme[] {
    return this.customThemes.map((theme) => ({ ...theme, colors: { ...theme.colors } }));
  }

  get(id: string): TerminalTheme | undefined {
    return this.customThemes.find((theme) => theme.id === id);
  }

  getActive(): string {
    return this.activeThemeId;
  }

  // Add an imported theme. Returns the stored theme, or null if the cap is
  // reached (callers surface `capacity`). Duplicates by name are allowed (each
  // import mints a fresh id), matching the browser's prior append behavior.
  add(theme: TerminalTheme): TerminalTheme | null {
    if (this.customThemes.length >= MAX_CUSTOM_THEMES) return null;
    const stored: TerminalTheme = { ...theme, colors: { ...theme.colors } };
    this.customThemes.push(stored);
    this.persist();
    return { ...stored, colors: { ...stored.colors } };
  }

  delete(id: string): boolean {
    const index = this.customThemes.findIndex((theme) => theme.id === id);
    if (index === -1) return false;
    this.customThemes.splice(index, 1);
    if (this.activeThemeId === id) this.activeThemeId = DEFAULT_TERMINAL_THEME_ID;
    this.persist();
    return true;
  }

  // Set the active theme id. The route validates `id` against the built-ins +
  // the stored custom themes before calling; the store trusts that and persists.
  setActive(id: string): string {
    this.activeThemeId = id;
    this.persist();
    return id;
  }

  // One-time migration from the browser's legacy localStorage state. Only acts
  // on a fresh (never-persisted) store so a later call from a second tab (or a
  // re-opened browser) can't clobber state the CLI or another tab already wrote.
  // Preserves the incoming custom theme ids so the active id still resolves.
  // Returns true when it adopted the payload, false when the store was already
  // initialized (the caller re-reads the current state either way).
  migrate(activeThemeId: string, customThemes: readonly TerminalTheme[]): boolean {
    if (this.initialized) return false;
    this.customThemes = customThemes.slice(0, MAX_CUSTOM_THEMES).map((theme) => ({
      ...theme,
      colors: { ...theme.colors },
    }));
    this.activeThemeId = this.sanitizeActiveId(activeThemeId);
    this.persist();
    return true;
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      console.warn(`themes file invalid; ignoring (${this.filePath})`);
      return;
    }
    const parsed = themesFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`themes file invalid; ignoring (${this.filePath})`);
      return;
    }
    this.customThemes = parsed.data.customThemes as TerminalTheme[];
    this.activeThemeId = this.sanitizeActiveId(parsed.data.activeThemeId);
    this.initialized = true;
  }

  // An active id is valid if it's a built-in (incl. "auto") or one of the stored
  // custom themes; otherwise the default. Called on load and after a delete
  // that removed the active theme so the file never points at a missing theme.
  private sanitizeActiveId(id: string): string {
    if (isBuiltinThemeId(id) || this.customThemes.some((theme) => theme.id === id)) return id;
    return DEFAULT_TERMINAL_THEME_ID;
  }

  private persist(): void {
    this.initialized = true;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: THEMES_FILE_VERSION,
      activeThemeId: this.activeThemeId,
      customThemes: this.customThemes,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmpPath, this.filePath);
  }
}
