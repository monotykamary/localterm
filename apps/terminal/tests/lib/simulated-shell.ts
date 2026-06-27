// A model of a cooked-mode shell's echo behavior: given a keystroke the server
// received, returns the exact bytes the shell would write back to the terminal.
// Covers the cases that stress the predictor: plain appending echo, mid-line
// insert/delete (readline redraws the tail and walks the cursor back),
// backspace-at-end (`\b \b`), arrow keys (`\e[D`/`\e[C`), Ctrl-U (line discard
// via `\r` + clear), a syntax-highlighting shell that reprints the whole line on
// each keystroke, and a silent `read -s` (no echo — the password case). The
// shell keeps its own `line`/`cursor` as the ground truth the harness diffs the
// terminal model against.

const BACKSPACE = "\b";
const BACKSPACE_KEY = "\x7f";
const CTRL_U = "\x15";
const LEFT_ARROW = "\x1b[D";
const RIGHT_ARROW = "\x1b[C";

export interface SimulatedShellOptions {
  prompt?: string;
  syntaxHighlight?: boolean;
  silent?: boolean;
}

export class SimulatedShell {
  readonly prompt: string;
  private readonly syntaxHighlight: boolean;
  private readonly silent: boolean;
  line = "";
  cursor = 0;

  constructor({
    prompt = "$ ",
    syntaxHighlight = false,
    silent = false,
  }: SimulatedShellOptions = {}) {
    this.prompt = prompt;
    this.syntaxHighlight = syntaxHighlight;
    this.silent = silent;
  }

  absoluteCursor = (): number => this.prompt.length + this.cursor;

  // Process a keystroke; returns the echo chunks the shell emits (in order).
  // Empty for silent mode (read -s) — but the keystroke is still recorded into
  // `line`/`cursor` so the harness can diff against the typed ground truth.
  feed = (keystroke: string): string[] => {
    const echoes = this.computeEcho(keystroke);
    return this.silent ? [] : echoes;
  };

  private computeEcho = (keystroke: string): string[] => {
    if (keystroke === BACKSPACE_KEY) return this.handleBackspace();
    if (keystroke === CTRL_U) return this.handleCtrlU();
    if (keystroke === LEFT_ARROW) {
      this.cursor = Math.max(0, this.cursor - 1);
      return [LEFT_ARROW];
    }
    if (keystroke === RIGHT_ARROW) {
      this.cursor = Math.min(this.line.length, this.cursor + 1);
      return [RIGHT_ARROW];
    }
    if (isPrintable(keystroke)) {
      this.line = this.line.slice(0, this.cursor) + keystroke + this.line.slice(this.cursor);
      this.cursor += 1;
      if (this.syntaxHighlight) return [this.reprintLine()];
      if (this.cursor === this.line.length) return [keystroke];
      const tail = this.line.slice(this.cursor);
      return [keystroke + tail + BACKSPACE.repeat(tail.length)];
    }
    return [];
  };

  private handleBackspace = (): string[] => {
    if (this.cursor === 0) return [];
    this.cursor -= 1;
    this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + 1);
    if (this.syntaxHighlight) return [this.reprintLine()];
    if (this.cursor === this.line.length) return ["\b \b"];
    const tail = this.line.slice(this.cursor);
    return ["\b" + tail + " \b" + BACKSPACE.repeat(tail.length)];
  };

  private handleCtrlU = (): string[] => {
    this.line = this.line.slice(this.cursor);
    this.cursor = 0;
    if (this.syntaxHighlight) return [this.reprintLine()];
    return ["\r\x1b[K" + this.prompt + this.line];
  };

  private reprintLine = (): string => "\r\x1b[K" + this.prompt + this.line;
}

const isPrintable = (chunk: string): boolean => {
  if ([...chunk].length !== 1) return false;
  const code = chunk.codePointAt(0) ?? 0;
  return code >= 0x20 && code < 0x7f;
};
