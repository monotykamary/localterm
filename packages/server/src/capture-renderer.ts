import { createRequire } from "node:module";
import { CAPTURE_RENDERER_SCROLLBACK } from "./constants.js";

// @xterm/headless ships a CJS `main` with no `exports` field and a broken
// `module` field (points at a non-existent file), so Node's ESM loader can't
// see `Terminal` as a named export and `import { Terminal }` throws at runtime.
// The types resolve fine via the package's `types` field, so load the runtime
// value through `createRequire` (which reads `module.exports` directly) and cast
// it to the package's own exported shape — fully type-safe, no `as any`.
const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless");

// A server-side terminal emulator fed from a session's raw PTY output so a
// `capture-pane`-style read returns clean, ANSI-processed cell text instead of
// the raw escape-sequence byte stream the browser's xterm.js otherwise owns.
// localterm has no screen model server-side (terminal emulation lives in the
// browser); this is the one piece of new machinery that gives the REST/CLI
// surfaces a grid to read, matching tmux's `capture-pane`.
//
// One renderer per session, lazily created on first capture and kept alive
// afterward — zero overhead for browser-only sessions that are never captured.
// Fed the session's scrollback snapshot at creation (so it catches up on
// recent history before the renderer existed) and its live output thereafter;
// resized in lockstep with the PTY; disposed on session exit/kill/teardown.
// The same xterm parser at the same version the browser uses, so alt-screen,
// OSC, SGR, and line-wrap are interpreted identically to what a tab shows.
export class CaptureRenderer {
  private readonly terminal: InstanceType<typeof Terminal>;
  private disposed = false;
  // xterm parses `write()` asynchronously (batched on a timer), so a buffer read
  // immediately after write returns blank. Serialize writes into a promise
  // chain and expose `flush()` so capture/exec readers can await all pending
  // parses before reading the grid — without forcing every live-feed write to
  // block (they stay fire-and-forget; only readers await).
  private writeChain: Promise<void> = Promise.resolve();

  constructor(cols: number, rows: number, scrollback: number = CAPTURE_RENDERER_SCROLLBACK) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    });
  }

  write(data: string): void {
    if (this.disposed || !data) return;
    this.writeChain = this.writeChain.then(() => this.writeAsync(data));
  }

  private writeAsync(data: string): Promise<void> {
    return new Promise((resolve) => {
      if (this.disposed) {
        resolve();
        return;
      }
      this.terminal.write(data, () => resolve());
    });
  }

  // Resolve once every write() so far has been parsed into the grid. Callers
  // that read the buffer (capture, exec extraction) await this first.
  async flush(): Promise<void> {
    await this.writeChain;
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    if (cols <= 0 || rows <= 0) return;
    if (cols === this.terminal.cols && rows === this.terminal.rows) return;
    this.terminal.resize(cols, rows);
  }

  // Read the last `lines` lines of the rendered grid as plain text (one row per
  // line, trailing whitespace trimmed). `lines` defaults to the visible
  // viewport (tmux `capture-pane -p` semantics); a larger value reaches into
  // scrollback. Trailing blank lines are stripped so an agent doesn't receive a
  // screenful of empty rows after a short command.
  capture(lines?: number): string {
    const buffer = this.terminal.buffer.active;
    const total = buffer.length;
    const count = lines && lines > 0 ? Math.min(lines, total) : this.terminal.rows;
    const startLine = Math.max(0, total - count);
    const rows: string[] = [];
    for (let index = startLine; index < total; index++) {
      const line = buffer.getLine(index);
      rows.push(line ? line.translateToString(true) : "");
    }
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    return rows.join("\n");
  }

  // Find the index of the bottom-most row whose trimmed content equals `needle`,
  // searching upward from the bottom of the buffer. Used by exec to locate its
  // start/end marker rows in the rendered grid.
  findRow(needle: string): number {
    const buffer = this.terminal.buffer.active;
    for (let index = buffer.length - 1; index >= 0; index--) {
      const line = buffer.getLine(index);
      if (line && line.translateToString(true) === needle) return index;
    }
    return -1;
  }

  // Slice the rendered rows strictly between `startRow` and `endRow` (exclusive
  // of both) as plain text, trimming trailing blanks. A `startRow` of -1 falls
  // back to 0 (the start marker never printed — shell exited immediately); an
  // `endRow` of -1 falls back to the full buffer length (no end marker — timed
  // out or the session exited). Used by exec to extract the command's output
  // between its start and end markers.
  extractBetween(startRow: number, endRow: number): string {
    const buffer = this.terminal.buffer.active;
    const begin = startRow >= 0 ? startRow + 1 : 0;
    const stop = endRow >= 0 ? endRow : buffer.length;
    const clampedStop = Math.max(begin, stop);
    const rows: string[] = [];
    for (let index = begin; index < clampedStop; index++) {
      const line = buffer.getLine(index);
      rows.push(line ? line.translateToString(true) : "");
    }
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    return rows.join("\n");
  }

  // Find the (col, row) of the bottom-most visible-row occurrence of `needle`
  // as a substring, searching the viewport from the bottom up. `row` is
  // viewport-relative (0 = top of the visible area), the coordinate system CDP
  // `Input.dispatchMouseEvent` and SGR mouse use. Returns null when the text
  // isn't on screen (scrolled out of the viewport) so `mouse --on-text` can
  // report a miss instead of clicking a stale cell. Used by `session mouse` to
  // resolve a label's position without a browser tab.
  findTextInViewport(needle: string): { col: number; row: number } | null {
    const buffer = this.terminal.buffer.active;
    const base = buffer.baseY;
    for (let row = this.terminal.rows - 1; row >= 0; row--) {
      const line = buffer.getLine(base + row);
      if (!line) continue;
      const text = line.translateToString(true);
      const col = text.indexOf(needle);
      if (col >= 0) return { col, row };
    }
    return null;
  }

  get cols(): number {
    return this.terminal.cols;
  }

  get rows(): number {
    return this.terminal.rows;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.terminal.dispose();
    } catch {
      /* already disposed */
    }
  }
}
