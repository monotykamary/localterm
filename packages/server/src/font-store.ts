import fs from "node:fs";
import path from "node:path";
import { FONTS_FILE_VERSION } from "./constants.js";
import { fontsFileSchema } from "./schemas.js";
import { DEFAULT_TERMINAL_FONT_ID, isBuiltinFontId } from "./terminal-fonts.js";

interface FontStoreOptions {
  filePath: string;
}

interface FontPatch {
  activeFontId?: string;
  customFontFamily?: string;
  nerdFontEnabled?: boolean;
  ligaturesEnabled?: boolean;
}

interface FontMigrateState {
  activeFontId: string;
  customFontFamily: string;
  nerdFontEnabled: boolean;
  ligaturesEnabled: boolean;
}

// Owns the persisted terminal font state in ~/.localterm/fonts.json: the
// active font id, the user-entered custom family, and the Nerd Font /
// ligatures toggles. Mirrors ThemeStore's load/persist shape (zod-validated
// read, atomic tmp+rename write). The active id is sanitized on load — a
// stale id (a hand-edited file, or a future removed built-in) falls back to
// the default rather than rendering with an unresolvable family.
export class FontStore {
  private activeFontId: string = DEFAULT_TERMINAL_FONT_ID;
  private customFontFamily: string = "";
  private nerdFontEnabled: boolean = false;
  private ligaturesEnabled: boolean = false;
  private initialized = false;
  private readonly filePath: string;

  constructor(options: FontStoreOptions) {
    this.filePath = options.filePath;
    this.load();
  }

  // True once ~/.localterm/fonts.json has been written (or loaded). The browser
  // uses it as a one-time migration gate: on first contact with an
  // uninitialized store it pushes its legacy localStorage font state so an
  // upgrade doesn't lose the user's font selection / toggles. Once
  // initialized, the store is the source of truth.
  isInitialized(): boolean {
    return this.initialized;
  }

  getActive(): string {
    return this.activeFontId;
  }

  getCustomFontFamily(): string {
    return this.customFontFamily;
  }

  getNerdFontEnabled(): boolean {
    return this.nerdFontEnabled;
  }

  getLigaturesEnabled(): boolean {
    return this.ligaturesEnabled;
  }

  // Apply a partial update. The route validates `activeFontId` against the
  // built-ins (incl. "custom") before calling; the store trusts that and
  // persists only the fields the caller supplied.
  update(patch: FontPatch): void {
    if (patch.activeFontId !== undefined) this.activeFontId = patch.activeFontId;
    if (patch.customFontFamily !== undefined) this.customFontFamily = patch.customFontFamily;
    if (patch.nerdFontEnabled !== undefined) this.nerdFontEnabled = patch.nerdFontEnabled;
    if (patch.ligaturesEnabled !== undefined) this.ligaturesEnabled = patch.ligaturesEnabled;
    this.persist();
  }

  // One-time migration from the browser's legacy localStorage state. Only
  // acts on a fresh (never-persisted) store so a later call from a second
  // tab (or a re-opened browser) can't clobber state the CLI or another tab
  // already wrote. Returns true when it adopted the payload, false when the
  // store was already initialized (the caller re-reads the current state
  // either way).
  migrate(state: FontMigrateState): boolean {
    if (this.initialized) return false;
    this.activeFontId = this.sanitizeActiveId(state.activeFontId);
    this.customFontFamily = state.customFontFamily;
    this.nerdFontEnabled = state.nerdFontEnabled;
    this.ligaturesEnabled = state.ligaturesEnabled;
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
      console.warn(`fonts file invalid; ignoring (${this.filePath})`);
      return;
    }
    const parsed = fontsFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`fonts file invalid; ignoring (${this.filePath})`);
      return;
    }
    this.activeFontId = this.sanitizeActiveId(parsed.data.activeFontId);
    this.customFontFamily = parsed.data.customFontFamily;
    this.nerdFontEnabled = parsed.data.nerdFontEnabled;
    this.ligaturesEnabled = parsed.data.ligaturesEnabled;
    this.initialized = true;
  }

  // An active id is valid if it's a built-in (incl. "custom"); otherwise the
  // default. Called on load so the file never points at a font that won't
  // resolve (the browser would silently fall back to the default family).
  private sanitizeActiveId(id: string): string {
    if (isBuiltinFontId(id)) return id;
    return DEFAULT_TERMINAL_FONT_ID;
  }

  private persist(): void {
    this.initialized = true;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: FONTS_FILE_VERSION,
      activeFontId: this.activeFontId,
      customFontFamily: this.customFontFamily,
      nerdFontEnabled: this.nerdFontEnabled,
      ligaturesEnabled: this.ligaturesEnabled,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmpPath, this.filePath);
  }
}
