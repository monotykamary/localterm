// A minimal terminal emulator that interprets the same byte sequences the
// real xterm.js does — printable writes, backspace, CR/LF, CSI cursor moves
// (CUF/CUB/CUU/CUD), erase (ED/EL), and the SGR dim attribute (2/22/0). It
// tracks a cursor and a grid of styled cells so a test can assert the EXACT
// screen state (chars + dim flags + cursor) after the real LocalEcho and a
// simulated shell have exchanged bytes through it. This is the golden model
// the harness diffs against the shell's ground-truth line: a desync between
// prediction and echo shows up here as wrong chars, leftover dim cells, or a
// misplaced cursor — exactly the class of bug a recording mock of
// terminal.write cannot catch.

const ESC = "\x1b";
const BACKSPACE = "\b";
const CARRIAGE_RETURN = "\r";
const LINE_FEED = "\n";

interface Cell {
  char: string;
  dim: boolean;
}

export interface TerminalModelOptions {
  cols?: number;
  rows?: number;
}

export class TerminalModel {
  readonly cols: number;
  readonly rows: number;
  cursorX = 0;
  cursorY = 0;
  private readonly grid: Cell[][];
  private dim = false;

  constructor({ cols = 80, rows = 24 }: TerminalModelOptions = {}) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ char: " ", dim: false })),
    );
  }

  write = (data: string | Uint8Array): void => {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    let i = 0;
    while (i < text.length) {
      const ch = text[i] ?? "";
      if (ch === ESC) {
        i = this.consumeEscape(text, i);
      } else if (ch === BACKSPACE) {
        this.cursorX = Math.max(0, this.cursorX - 1);
        i += 1;
      } else if (ch === CARRIAGE_RETURN) {
        this.cursorX = 0;
        i += 1;
      } else if (ch === LINE_FEED) {
        this.cursorY = Math.min(this.rows - 1, this.cursorY + 1);
        i += 1;
      } else if (ch >= " ") {
        this.putChar(ch);
        this.cursorX += 1;
        if (this.cursorX >= this.cols) {
          this.cursorX = 0;
          this.cursorY = Math.min(this.rows - 1, this.cursorY + 1);
        }
        i += 1;
      } else {
        i += 1;
      }
    }
  };

  cellAt = (x: number, y: number = this.cursorY): Cell | null => this.grid[y]?.[x] ?? null;

  hasDimInRow = (y: number = this.cursorY): boolean =>
    (this.grid[y] ?? []).some((cell) => cell.dim);

  private putChar = (ch: string): void => {
    const row = this.grid[this.cursorY];
    if (!row) return;
    row[this.cursorX] = { char: ch, dim: this.dim };
  };

  private consumeEscape = (text: string, i: number): number => {
    const next = text[i + 1] ?? "";
    if (next === "[") {
      let j = i + 2;
      let privateMark = "";
      if (text[j] === "?") {
        privateMark = "?";
        j += 1;
      }
      let params = "";
      while (j < text.length && /[\d;]/.test(text[j] ?? "")) {
        params += text[j];
        j += 1;
      }
      const final = text[j] ?? "";
      this.applyCsi(privateMark, params, final);
      return j + 1;
    }
    if (next === "H") {
      this.cursorY = 0;
      return i + 2;
    }
    return i + 2;
  };

  private applyCsi = (privateMark: string, params: string, final: string): void => {
    if (privateMark) return;
    const nums = params.length === 0 ? [] : params.split(";").map((p) => Number(p) || 0);
    const first = nums[0] ?? 0;
    switch (final) {
      case "A":
        this.cursorY = Math.max(0, this.cursorY - Math.max(1, first));
        break;
      case "B":
        this.cursorY = Math.min(this.rows - 1, this.cursorY + Math.max(1, first));
        break;
      case "C":
        this.cursorX = Math.min(this.cols - 1, this.cursorX + Math.max(1, first));
        break;
      case "D":
        this.cursorX = Math.max(0, this.cursorX - Math.max(1, first));
        break;
      case "J":
        this.eraseDisplay(first);
        break;
      case "K":
        this.eraseLine(first);
        break;
      case "H":
        this.cursorY = Math.min(this.rows - 1, (nums[1] ?? 1) - 1);
        this.cursorX = Math.min(this.cols - 1, (nums[0] ?? 1) - 1);
        break;
      case "m":
        this.applySgr(nums);
        break;
      default:
        break;
    }
  };

  private applySgr = (nums: number[]): void => {
    if (nums.length === 0) {
      this.dim = false;
      return;
    }
    for (const num of nums) {
      if (num === 0) this.dim = false;
      else if (num === 2) this.dim = true;
      else if (num === 22) this.dim = false;
    }
  };

  private eraseDisplay = (mode: number): void => {
    if (mode === 2 || mode === 3) {
      for (const row of this.grid)
        for (let c = 0; c < this.cols; c++) row[c] = { char: " ", dim: false };
    } else if (mode === 0) {
      const row = this.grid[this.cursorY];
      if (row) for (let c = this.cursorX; c < this.cols; c++) row[c] = { char: " ", dim: false };
    } else if (mode === 1) {
      const row = this.grid[this.cursorY];
      if (row) for (let c = 0; c <= this.cursorX; c++) row[c] = { char: " ", dim: false };
    }
  };

  private eraseLine = (mode: number): void => {
    const row = this.grid[this.cursorY];
    if (!row) return;
    if (mode === 0)
      for (let c = this.cursorX; c < this.cols; c++) row[c] = { char: " ", dim: false };
    else if (mode === 1) for (let c = 0; c <= this.cursorX; c++) row[c] = { char: " ", dim: false };
    else if (mode === 2) for (let c = 0; c < this.cols; c++) row[c] = { char: " ", dim: false };
  };
}
