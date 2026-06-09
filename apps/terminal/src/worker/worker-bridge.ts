import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { SAB_HEADER_OFFSET_COLS, SAB_HEADER_OFFSET_ROWS, SAB_CELL_INT32S } from "./constants";
import { createSab, waitForSafeRead, getDirtyRange, getScrollState } from "./render-model-sab";
import type { SabLayout } from "./render-model-sab";

interface CombinedCellEntry {
  row: number;
  col: number;
  text: string;
}

interface FrameReadyMessage {
  type: "frame-ready";
  combinedCells: CombinedCellEntry[];
}

interface WorkerBridgeOptions {
  cols: number;
  rows: number;
  scrollback: number;
}

class WorkerBridge {
  private worker: Worker | null = null;
  private sab: SabLayout | null = null;
  private terminal: XtermTerminal | null = null;
  private pendingData: string[] = [];
  private initialized = false;

  init = (options: WorkerBridgeOptions): void => {
    this.sab = createSab(options.cols, options.rows);

    try {
      this.worker = new Worker(new URL("./vt-worker.ts", import.meta.url), { type: "module" });
    } catch {
      this.sab = null;
      return;
    }

    this.worker.onmessage = (event: MessageEvent<FrameReadyMessage>) => {
      const message = event.data;
      if (message.type === "frame-ready") {
        this.applySabToTerminal(message.combinedCells);
      }
    };

    this.worker.postMessage(
      {
        type: "init",
        sab: this.sab.buffer,
        cols: options.cols,
        rows: options.rows,
        scrollback: options.scrollback,
      },
      [this.sab.buffer],
    );

    this.initialized = true;

    for (const data of this.pendingData) {
      this.feed(data);
    }
    this.pendingData = [];
  };

  setTerminal = (terminal: XtermTerminal): void => {
    this.terminal = terminal;
  };

  feed = (data: string): void => {
    if (!this.initialized || !this.worker) {
      this.pendingData.push(data);
      return;
    }
    this.worker.postMessage({ type: "data", data });
  };

  resize = (cols: number, rows: number): void => {
    if (!this.worker || !this.initialized) return;

    if (this.sab) {
      const header = this.sab.header;
      if (header[SAB_HEADER_OFFSET_COLS] !== cols || header[SAB_HEADER_OFFSET_ROWS] !== rows) {
        this.sab = createSab(cols, rows);
        this.worker.postMessage({ type: "resize", cols, rows }, [this.sab.buffer]);
      }
    }

    this.worker.postMessage({ type: "resize", cols, rows });
  };

  setScrollback = (scrollback: number): void => {
    if (!this.worker || !this.initialized) return;
    this.worker.postMessage({ type: "scrollback", scrollback });
  };

  private applySabToTerminal = (combinedCells: CombinedCellEntry[]): void => {
    if (!this.sab || !this.terminal) return;

    const { header, cells, cols, rows } = this.sab;
    waitForSafeRead(header);

    const internals = this.terminal as unknown as {
      _core: {
        _bufferService: {
          buffer: {
            ydisp: number;
            ybase: number;
            lines: { get(index: number): any };
          };
        };
      };
    };

    const buffer = internals._core?._bufferService?.buffer;
    if (!buffer) return;

    const scrollState = getScrollState(header);
    const dirtyRange = getDirtyRange(header);

    for (let y = dirtyRange.dirtyStart; y < dirtyRange.dirtyEnd && y < rows; y++) {
      const lineNumber = scrollState.ydisp + y;
      const bufferLine = buffer.lines.get(lineNumber);
      if (!bufferLine) continue;

      const lineData = bufferLine._data as Uint32Array | undefined;
      if (!lineData) continue;

      const srcOffset = y * cols * SAB_CELL_INT32S;
      const cellCount = Math.min(cols, lineData.length / SAB_CELL_INT32S);

      for (let x = 0; x < cellCount; x++) {
        const srcIdx = srcOffset + x * SAB_CELL_INT32S;
        const dstIdx = x * SAB_CELL_INT32S;
        lineData[dstIdx] = cells[srcIdx];
        lineData[dstIdx + 1] = cells[srcIdx + 1];
        lineData[dstIdx + 2] = cells[srcIdx + 2];
      }

      if (bufferLine._stringCacheEntryRef) {
        bufferLine._stringCacheEntryRef = undefined;
      }
    }

    for (const entry of combinedCells) {
      const lineNumber = scrollState.ydisp + entry.row;
      const bufferLine = buffer.lines.get(lineNumber);
      if (bufferLine && entry.text) {
        bufferLine._combined[entry.col] = entry.text;
      }
    }

    if (scrollState.ydisp !== buffer.ydisp || scrollState.ybase !== buffer.ybase) {
      this.terminal.scrollLines(scrollState.ydisp - buffer.ydisp);
    }

    if (dirtyRange.dirtyEnd > dirtyRange.dirtyStart) {
      this.terminal.refresh(dirtyRange.dirtyStart, dirtyRange.dirtyEnd - 1);
    }
  };

  dispose = (): void => {
    this.worker?.terminate();
    this.worker = null;
    this.sab = null;
    this.terminal = null;
    this.initialized = false;
  };

  isReady = (): boolean => this.initialized;

  getSab = (): SharedArrayBuffer | null => this.sab?.buffer ?? null;
}

export { WorkerBridge };
