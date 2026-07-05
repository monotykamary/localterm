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
// the window), freezing the screen. Kitty keyboard is a push/pop stack, not a
// simple toggle, and is left to the replay bytes. Cursor visibility (25) is
// tracked as a hide flag so a TUI that hid the cursor can restore the hide
// over the client's default `?25h`.

const ESC = "\x1b";

const RESTORABLE_PRIVATE_MODES = new Set([
  1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1015, 1047, 1048, 1049, 2004,
]);

/* eslint-disable-next-line no-control-regex -- matches ANSI DECRQM mode-set sequences; control char is intentional */
const DECRQM_PATTERN = /\x1b\[\?(\d+)([hl])/g;

const sortedRestorableModes = (modes: Set<number>): number[] =>
  Array.from(modes)
    .filter((mode) => RESTORABLE_PRIVATE_MODES.has(mode))
    .sort((a, b) => a - b);

export class TerminalModeState {
  private readonly enabledModes = new Set<number>();
  private cursorHidden = false;

  update(data: string): void {
    DECRQM_PATTERN.lastIndex = 0;
    let match = DECRQM_PATTERN.exec(data);
    while (match !== null) {
      const mode = Number.parseInt(match[1], 10);
      const action = match[2];
      if (mode === 25) {
        this.cursorHidden = action === "l";
      } else if (action === "h") {
        this.enabledModes.add(mode);
      } else {
        this.enabledModes.delete(mode);
      }
      match = DECRQM_PATTERN.exec(data);
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
