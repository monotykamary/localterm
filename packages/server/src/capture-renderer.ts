import { createRequire } from "node:module";
import {
  CAPTURE_RENDERER_PENDING_CHUNK_COMPACT_COUNT,
  CAPTURE_RENDERER_SCROLLBACK,
} from "./constants.js";
import { renderBufferLineWithSgr } from "./utils/render-buffer-line-with-sgr.js";

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
interface FlushWaiter {
  resolve: () => void;
  targetSequence: number;
}

// The hibernation renderer is always on; capture-pane renderers are created
// lazily. Both receive live PTY output. xterm parses asynchronously, so keep one
// write in flight, coalesce the next batch, and expose its byte backlog to PTY
// flow control instead of retaining one Promise closure per PTY fragment.
export class CaptureRenderer {
  private readonly terminal: InstanceType<typeof Terminal>;
  private completedSequence = 0;
  private disposed = false;
  private enqueuedSequence = 0;
  private flushWaiters: FlushWaiter[] = [];
  private pendingByteLength = 0;
  private pendingChunks: string[] = [];
  private queuedByteLengthValue = 0;
  private writeInFlight = false;

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
    const byteLength = Buffer.byteLength(data, "utf8");
    this.enqueuedSequence += 1;
    this.pendingChunks.push(data);
    this.pendingByteLength += byteLength;
    this.queuedByteLengthValue += byteLength;
    if (this.pendingChunks.length >= CAPTURE_RENDERER_PENDING_CHUNK_COMPACT_COUNT) {
      this.pendingChunks = [this.pendingChunks.join("")];
    }
    this.pump();
  }

  private pump(): void {
    if (this.disposed || this.writeInFlight || this.pendingChunks.length === 0) return;
    const chunks = this.pendingChunks;
    const batchByteLength = this.pendingByteLength;
    const batchSequence = this.enqueuedSequence;
    this.pendingChunks = [];
    this.pendingByteLength = 0;
    this.writeInFlight = true;
    const data = chunks.length === 1 ? chunks[0] : chunks.join("");
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      this.writeInFlight = false;
      this.queuedByteLengthValue = Math.max(0, this.queuedByteLengthValue - batchByteLength);
      this.completedSequence = Math.max(this.completedSequence, batchSequence);
      this.resolveFlushWaiters();
      this.pump();
    };
    try {
      this.terminal.write(data, finish);
    } catch {
      finish();
    }
  }

  private resolveFlushWaiters(): void {
    const pending: FlushWaiter[] = [];
    for (const waiter of this.flushWaiters) {
      if (this.completedSequence >= waiter.targetSequence) waiter.resolve();
      else pending.push(waiter);
    }
    this.flushWaiters = pending;
  }

  flush(): Promise<void> {
    const targetSequence = this.enqueuedSequence;
    if (this.disposed || this.completedSequence >= targetSequence) return Promise.resolve();
    return new Promise((resolve) => {
      this.flushWaiters.push({ resolve, targetSequence });
    });
  }

  get queuedBytes(): number {
    return this.queuedByteLengthValue;
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    if (cols <= 0 || rows <= 0) return;
    if (cols === this.terminal.cols && rows === this.terminal.rows) return;
    this.terminal.resize(cols, rows);
  }

  // Read the last `lines` lines of the active rendered grid as plain text (one row per
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

  // Hibernation reads the normal buffer even while a TUI owns the alternate
  // buffer. Only rendered text and SGR styling are exported; cursor movement,
  // screen clearing, OSC, and terminal modes can never enter the snapshot.
  captureNormal(maxLines: number, maxCodeUnits: number): string {
    const buffer = this.terminal.buffer.normal;
    const cell = buffer.getNullCell();
    const rows: string[] = [];
    let codeUnits = 0;
    const start = Math.max(0, buffer.length - maxLines);
    for (let index = buffer.length - 1; index >= start; index -= 1) {
      const line = buffer.getLine(index);
      const row = line ? renderBufferLineWithSgr(line, cell) : "";
      const separatorLength = rows.length === 0 ? 0 : 2;
      if (codeUnits + separatorLength + row.length > maxCodeUnits) break;
      rows.push(row);
      codeUnits += separatorLength + row.length;
    }
    rows.reverse();
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    return rows.join("\r\n");
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
    this.pendingChunks = [];
    this.pendingByteLength = 0;
    this.queuedByteLengthValue = 0;
    this.completedSequence = this.enqueuedSequence;
    this.resolveFlushWaiters();
    try {
      this.terminal.dispose();
    } catch {
      /* already disposed */
    }
  }
}
