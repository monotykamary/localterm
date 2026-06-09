import {
  SAB_MAGIC,
  SAB_VERSION,
  SAB_HEADER_INT32S,
  SAB_HEADER_OFFSET_MAGIC,
  SAB_HEADER_OFFSET_VERSION,
  SAB_HEADER_OFFSET_COLS,
  SAB_HEADER_OFFSET_ROWS,
  SAB_HEADER_OFFSET_CURSOR_X,
  SAB_HEADER_OFFSET_CURSOR_Y,
  SAB_HEADER_OFFSET_CURSOR_VISIBLE,
  SAB_HEADER_OFFSET_DIRTY_START,
  SAB_HEADER_OFFSET_DIRTY_END,
  SAB_HEADER_OFFSET_READY,
  SAB_HEADER_OFFSET_SCROLL_YBASE,
  SAB_HEADER_OFFSET_SCROLL_YDISP,
  SAB_HEADER_OFFSET_SCROLLBACK_LENGTH,
  SAB_HEADER_OFFSET_ALT_SCREEN_ACTIVE,
  SAB_CELLS_OFFSET,
  SAB_CELL_INT32S,
  SAB_READY_WRITING,
  SAB_READY_SAFE_TO_READ,
  MAX_SAB_COLS,
  MAX_SAB_ROWS,
} from "./constants";

interface SabLayout {
  header: Int32Array;
  cells: Uint32Array;
  buffer: SharedArrayBuffer;
  cols: number;
  rows: number;
}

const computeByteLength = (cols: number, rows: number): number =>
  (SAB_HEADER_INT32S + cols * rows * SAB_CELL_INT32S) * 4;

const createSab = (cols: number, rows: number): SabLayout => {
  const clampedCols = Math.min(cols, MAX_SAB_COLS);
  const clampedRows = Math.min(rows, MAX_SAB_ROWS);
  const byteLength = computeByteLength(clampedCols, clampedRows);
  const buffer = new SharedArrayBuffer(byteLength);
  const header = new Int32Array(buffer, 0, SAB_HEADER_INT32S);
  const totalCellInt32s = clampedCols * clampedRows * SAB_CELL_INT32S;
  const cells = new Uint32Array(buffer, SAB_CELLS_OFFSET * 4, totalCellInt32s);

  header[SAB_HEADER_OFFSET_MAGIC] = SAB_MAGIC;
  header[SAB_HEADER_OFFSET_VERSION] = SAB_VERSION;
  header[SAB_HEADER_OFFSET_COLS] = clampedCols;
  header[SAB_HEADER_OFFSET_ROWS] = clampedRows;
  header[SAB_HEADER_OFFSET_READY] = SAB_READY_SAFE_TO_READ;
  header[SAB_HEADER_OFFSET_CURSOR_VISIBLE] = 1;

  return { header, cells, buffer, cols: clampedCols, rows: clampedRows };
};

const connectToSab = (buffer: SharedArrayBuffer): SabLayout => {
  const header = new Int32Array(buffer, 0, SAB_HEADER_INT32S);
  const cols = header[SAB_HEADER_OFFSET_COLS];
  const rows = header[SAB_HEADER_OFFSET_ROWS];
  const totalCellInt32s = cols * rows * SAB_CELL_INT32S;
  const cells = new Uint32Array(buffer, SAB_CELLS_OFFSET * 4, totalCellInt32s);
  return { header, cells, buffer, cols, rows };
};

const waitForSafeRead = (header: Int32Array): void => {
  const spin = () => {
    if (Atomics.load(header, SAB_HEADER_OFFSET_READY) === SAB_READY_SAFE_TO_READ) {
      return;
    }
    Atomics.wait(header, SAB_HEADER_OFFSET_READY, SAB_READY_WRITING);
    spin();
  };
  spin();
};

const markWriting = (header: Int32Array): void => {
  Atomics.store(header, SAB_HEADER_OFFSET_READY, SAB_READY_WRITING);
};

const markReady = (header: Int32Array): void => {
  Atomics.store(header, SAB_HEADER_OFFSET_READY, SAB_READY_SAFE_TO_READ);
  Atomics.notify(header, SAB_HEADER_OFFSET_READY);
};

const getDirtyRange = (header: Int32Array): { dirtyStart: number; dirtyEnd: number } => ({
  dirtyStart: header[SAB_HEADER_OFFSET_DIRTY_START],
  dirtyEnd: header[SAB_HEADER_OFFSET_DIRTY_END],
});

const setDirtyRange = (header: Int32Array, dirtyStart: number, dirtyEnd: number): void => {
  header[SAB_HEADER_OFFSET_DIRTY_START] = dirtyStart;
  header[SAB_HEADER_OFFSET_DIRTY_END] = dirtyEnd;
};

const getCursorPosition = (
  header: Int32Array,
): { cursorX: number; cursorY: number; cursorVisible: boolean } => ({
  cursorX: header[SAB_HEADER_OFFSET_CURSOR_X],
  cursorY: header[SAB_HEADER_OFFSET_CURSOR_Y],
  cursorVisible: header[SAB_HEADER_OFFSET_CURSOR_VISIBLE] === 1,
});

const setCursorPosition = (
  header: Int32Array,
  cursorX: number,
  cursorY: number,
  cursorVisible: boolean,
): void => {
  header[SAB_HEADER_OFFSET_CURSOR_X] = cursorX;
  header[SAB_HEADER_OFFSET_CURSOR_Y] = cursorY;
  header[SAB_HEADER_OFFSET_CURSOR_VISIBLE] = cursorVisible ? 1 : 0;
};

const getScrollState = (
  header: Int32Array,
): {
  ybase: number;
  ydisp: number;
  scrollbackLength: number;
  altScreenActive: boolean;
} => ({
  ybase: header[SAB_HEADER_OFFSET_SCROLL_YBASE],
  ydisp: header[SAB_HEADER_OFFSET_SCROLL_YDISP],
  scrollbackLength: header[SAB_HEADER_OFFSET_SCROLLBACK_LENGTH],
  altScreenActive: header[SAB_HEADER_OFFSET_ALT_SCREEN_ACTIVE] === 1,
});

const setScrollState = (
  header: Int32Array,
  ybase: number,
  ydisp: number,
  scrollbackLength: number,
  altScreenActive: boolean,
): void => {
  header[SAB_HEADER_OFFSET_SCROLL_YBASE] = ybase;
  header[SAB_HEADER_OFFSET_SCROLL_YDISP] = ydisp;
  header[SAB_HEADER_OFFSET_SCROLLBACK_LENGTH] = scrollbackLength;
  header[SAB_HEADER_OFFSET_ALT_SCREEN_ACTIVE] = altScreenActive ? 1 : 0;
};

export {
  computeByteLength,
  createSab,
  connectToSab,
  waitForSafeRead,
  markWriting,
  markReady,
  getDirtyRange,
  setDirtyRange,
  getCursorPosition,
  setCursorPosition,
  getScrollState,
  setScrollState,
};

export type { SabLayout };
