import {
  KITTY_KEYBOARD_SET_MODE_AND_NOT,
  KITTY_KEYBOARD_SET_MODE_OR,
  KITTY_KEYBOARD_SET_MODE_REPLACE,
  KITTY_KEYBOARD_STACK_MAX_DEPTH,
  MAX_PENDING_PARSE_BYTES,
  TERMINAL_ALTERNATE_SCREEN_PRIVATE_MODE_CODES,
} from "../constants.js";

interface KittyKeyboardModeState {
  flags: number;
  stack: number[];
}

// Tracks the live state of the terminal private modes that a scrollback replay
// must re-establish for a switched-to TUI to behave correctly. The replay ring
// buffer holds only the last ~256KB of raw PTY bytes, so a long-running TUI's
// mode-set sequences (alt-screen enter, mouse enable, bracketed paste) often
// scroll out of the window — replaying the bytes into a fresh xterm.js after a
// reset then leaves the terminal in the normal buffer with no mouse, and the
// wheel scrolls xterm's scrollback instead of the TUI. snapshotScrollback()
// prepends a restore prefix built from this tracker so xterm starts in the
// PTY's current mode state before the replayed content lands.
//
// Scope is deliberately narrow: only the modes that change how the replay
// renders or routes input. Synchronized-output mode (2026) is intentionally
// excluded — restoring it risks leaving xterm in a buffered state if the
// snapshot was taken mid-redraw (a `?2026h` whose matching `?2026l` is outside
// the window), freezing the screen. Kitty keyboard's push/pop stack is tracked
// separately and reasserted after replay. Cursor visibility (25) is tracked as
// a hide flag so a TUI that hid the cursor can restore the hide over the
// client's default `?25h`.

const ESC = "\x1b";
const RIS_SEQUENCE = `${ESC}c`;

const RESTORABLE_PRIVATE_MODES = new Set([
  1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1015, 1047, 1048, 1049, 2004,
]);
const ALTERNATE_SCREEN_PRIVATE_MODES = new Set(TERMINAL_ALTERNATE_SCREEN_PRIVATE_MODE_CODES);

/* eslint-disable no-control-regex -- matches ANSI/VT mode sequences; control characters are intentional */
const TERMINAL_MODE_PATTERN = /\x1bc|\x1b\[\?([\d;]+)([hl])|\x1b\[([=><])([\d;]*)u/g;
const INCOMPLETE_CSI_PATTERN = /\x1b\[[\x20-\x3f]*$/;
/* eslint-enable no-control-regex */

const sortedRestorableModes = (modes: Set<number>): number[] =>
  Array.from(modes)
    .filter((mode) => RESTORABLE_PRIVATE_MODES.has(mode))
    .sort((firstMode, secondMode) => firstMode - secondMode);

const createKittyKeyboardModeState = (): KittyKeyboardModeState => ({ flags: 0, stack: [] });

const parseModeParameter = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === "") return fallback;
  return Number.parseInt(value, 10);
};

const findPendingModeSequence = (data: string): string => {
  if (data.endsWith(ESC)) return ESC;
  const pendingSequence = INCOMPLETE_CSI_PATTERN.exec(data)?.[0] ?? "";
  return pendingSequence.length <= MAX_PENDING_PARSE_BYTES ? pendingSequence : "";
};

const resetKittyKeyboardMode = (state: KittyKeyboardModeState): void => {
  state.flags = 0;
  state.stack.length = 0;
};

export class TerminalModeState {
  private readonly enabledModes = new Set<number>();
  private readonly mainKittyKeyboardMode = createKittyKeyboardModeState();
  private readonly alternateKittyKeyboardMode = createKittyKeyboardModeState();
  private cursorHidden = false;
  private isAlternateScreenActive = false;
  private pendingModeSequence = "";

  update(data: string): void {
    const combined = this.pendingModeSequence + data;
    this.pendingModeSequence = findPendingModeSequence(combined);
    const completeData =
      this.pendingModeSequence.length === 0
        ? combined
        : combined.slice(0, -this.pendingModeSequence.length);

    TERMINAL_MODE_PATTERN.lastIndex = 0;
    let match = TERMINAL_MODE_PATTERN.exec(completeData);
    while (match !== null) {
      if (match[0] === RIS_SEQUENCE) {
        this.reset();
      } else if (match[1] !== undefined && match[2] !== undefined) {
        this.updatePrivateModes(match[1], match[2]);
      } else if (match[3] !== undefined) {
        this.updateKittyKeyboardMode(match[3], match[4] ?? "");
      }
      match = TERMINAL_MODE_PATTERN.exec(completeData);
    }
  }

  restorePrefix(): string {
    const parts: string[] = [];
    for (const mode of sortedRestorableModes(this.enabledModes)) {
      parts.push(`${ESC}[?${mode}h`);
    }
    if (this.cursorHidden) parts.push(`${ESC}[?25l`);
    return parts.join("");
  }

  restoreReplay(data: string): string {
    return this.restorePrefix() + data + this.restoreKittyKeyboardMode();
  }

  private updatePrivateModes(parameters: string, action: string): void {
    for (const parameter of parameters.split(";")) {
      const mode = Number.parseInt(parameter, 10);
      if (mode === 25) {
        this.cursorHidden = action === "l";
      } else if (action === "h") {
        this.enabledModes.add(mode);
      } else {
        this.enabledModes.delete(mode);
      }
      if (ALTERNATE_SCREEN_PRIVATE_MODES.has(mode)) {
        this.isAlternateScreenActive = action === "h";
      }
    }
  }

  private updateKittyKeyboardMode(action: string, parameters: string): void {
    const values = parameters.split(";");
    const flags = parseModeParameter(values[0], 0);
    const state = this.activeKittyKeyboardMode();

    if (action === ">") {
      if (state.stack.length >= KITTY_KEYBOARD_STACK_MAX_DEPTH) state.stack.shift();
      state.stack.push(state.flags);
      state.flags = flags;
      return;
    }

    if (action === "<") {
      const count = Math.max(1, flags);
      for (let popIndex = 0; popIndex < count && state.stack.length > 0; popIndex += 1) {
        state.flags = state.stack.pop() ?? 0;
      }
      if (state.stack.length === 0) state.flags = 0;
      return;
    }

    const mode = parseModeParameter(values[1], KITTY_KEYBOARD_SET_MODE_REPLACE);
    if (mode === KITTY_KEYBOARD_SET_MODE_REPLACE) {
      state.flags = flags;
    } else if (mode === KITTY_KEYBOARD_SET_MODE_OR) {
      state.flags |= flags;
    } else if (mode === KITTY_KEYBOARD_SET_MODE_AND_NOT) {
      state.flags &= ~flags;
    }
  }

  private activeKittyKeyboardMode(): KittyKeyboardModeState {
    return this.isAlternateScreenActive
      ? this.alternateKittyKeyboardMode
      : this.mainKittyKeyboardMode;
  }

  private restoreKittyKeyboardMode(): string {
    const state = this.activeKittyKeyboardMode();
    if (state.flags === 0 && state.stack.length === 0) return "";

    const parts = [`${ESC}[<${KITTY_KEYBOARD_STACK_MAX_DEPTH}u`];
    const firstStackedFlags = state.stack[0];
    if (firstStackedFlags === undefined) {
      parts.push(`${ESC}[=${state.flags}u`);
      return parts.join("");
    }
    if (firstStackedFlags !== 0) parts.push(`${ESC}[=${firstStackedFlags}u`);
    for (let stackIndex = 1; stackIndex < state.stack.length; stackIndex += 1) {
      parts.push(`${ESC}[>${state.stack[stackIndex]}u`);
    }
    parts.push(`${ESC}[>${state.flags}u`);
    return parts.join("");
  }

  private reset(): void {
    this.enabledModes.clear();
    this.cursorHidden = false;
    this.isAlternateScreenActive = false;
    resetKittyKeyboardMode(this.mainKittyKeyboardMode);
    resetKittyKeyboardMode(this.alternateKittyKeyboardMode);
  }

  // Whether a mouse *tracking* mode is enabled (1000–1003) — gates the SGR
  // fallback so mouse bytes are never written into an app that didn't ask for
  // them (where they'd land as typed text). Encoding modes (1005/1006/1007/1015)
  // and focus reporting (1004) are excluded: they change the format or report
  // focus, not whether the app reads mouse events. xterm.js gates this itself
  // in the CDP path; this is for the true-headless fallback.
  get mouseEnabled(): boolean {
    for (const mode of this.enabledModes) {
      if (mode >= 1000 && mode <= 1003) return true;
    }
    return false;
  }
}
