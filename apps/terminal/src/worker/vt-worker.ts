import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SAB_CELL_INT32S, CONTENT_IS_COMBINED_MASK, CONTENT_WIDTH_SHIFT } from "./constants";
import {
  connectToSab,
  markWriting,
  markReady,
  setDirtyRange,
  setCursorPosition,
  setScrollState,
} from "./render-model-sab";
import type { SabLayout } from "./render-model-sab";

interface WorkerInitMessage {
  type: "init";
  sab: SharedArrayBuffer;
  cols: number;
  rows: number;
  scrollback: number;
}

interface WorkerDataMessage {
  type: "data";
  data: string;
}

interface WorkerResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

interface WorkerScrollbackMessage {
  type: "scrollback";
  scrollback: number;
}

type WorkerInboundMessage =
  | WorkerInitMessage
  | WorkerDataMessage
  | WorkerResizeMessage
  | WorkerScrollbackMessage;

interface CombinedCellEntry {
  row: number;
  col: number;
  text: string;
}

interface FrameReadyMessage {
  type: "frame-ready";
  combinedCells: CombinedCellEntry[];
}

let sab: SabLayout | null = null;
let terminal: HeadlessTerminal | null = null;

const extractViewportIntoSab = (): CombinedCellEntry[] => {
  if (!sab || !terminal) return [];

  const { header, cells, cols, rows } = sab;
  const buffer = terminal.buffer.active;
  const bufferInternals = buffer as unknown as {
    _bufferService: {
      buffer: {
        ydisp: number;
        ybase: number;
        lines: { get(index: number): any };
      };
    };
  };
  const internalBuffer = bufferInternals._bufferService?.buffer ?? (bufferInternals as any);
  const ydisp = internalBuffer.ydisp as number;
  const ybase = internalBuffer.ybase as number;
  const lines = internalBuffer.lines as { get(index: number): any } | undefined;
  const combinedCells: CombinedCellEntry[] = [];

  markWriting(header);

  const dirtyStart = 0;
  let dirtyEnd = 0;

  for (let y = 0; y < rows; y++) {
    const lineNumber = ydisp + y;
    const bufferLine = lines ? lines.get(lineNumber) : null;
    let rowDirty = false;

    for (let x = 0; x < cols; x++) {
      const cellOffset = (y * cols + x) * SAB_CELL_INT32S;
      if (bufferLine) {
        const lineData = bufferLine._data as Uint32Array;
        const srcOffset = x * SAB_CELL_INT32S;
        const content = lineData[srcOffset];
        const fg = lineData[srcOffset + 1];
        const bg = lineData[srcOffset + 2];

        cells[cellOffset] = content;
        cells[cellOffset + 1] = fg;
        cells[cellOffset + 2] = bg;

        if (content & CONTENT_IS_COMBINED_MASK) {
          const combined = bufferLine._combined as Record<number, string>;
          if (combined[x]) {
            combinedCells.push({ row: y, col: x, text: combined[x] });
          }
        }

        if (!rowDirty) {
          rowDirty = content !== 0 || fg !== 0 || bg !== 0;
        }
      } else {
        cells[cellOffset] = 1 << CONTENT_WIDTH_SHIFT;
        cells[cellOffset + 1] = 0;
        cells[cellOffset + 2] = 0;
      }
    }

    if (rowDirty) dirtyEnd = y + 1;
  }

  setDirtyRange(header, dirtyStart, dirtyEnd);
  setCursorPosition(header, buffer.cursorX, buffer.cursorY, true);
  setScrollState(header, ybase, ydisp, buffer.length, buffer.type === "alternate");

  markReady(header);

  return combinedCells;
};

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    sab = connectToSab(message.sab);
    terminal = new HeadlessTerminal({
      cols: message.cols,
      rows: message.rows,
      scrollback: message.scrollback,
    });
    return;
  }

  if (!terminal || !sab) return;

  if (message.type === "data") {
    terminal.write(message.data, () => {
      const combinedCells = extractViewportIntoSab();
      const frameMessage: FrameReadyMessage = {
        type: "frame-ready",
        combinedCells,
      };
      self.postMessage(frameMessage);
    });
    return;
  }

  if (message.type === "resize") {
    terminal.resize(message.cols, message.rows);
    extractViewportIntoSab();
    return;
  }

  if (message.type === "scrollback") {
    terminal.options.scrollback = message.scrollback;
    extractViewportIntoSab();
    return;
  }
};
