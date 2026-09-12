export interface TerminalCellPoint {
  col: number;
  row: number;
}

interface TerminalCellMetrics {
  cols: number;
  rows: number;
  buffer: { active: { viewportY: number } };
}

interface TerminalRangeSelection {
  cols: number;
  select: (column: number, row: number, length: number) => void;
}

export const getTerminalCellFromPoint = (
  screen: HTMLElement,
  terminal: TerminalCellMetrics,
  clientX: number,
  clientY: number,
): TerminalCellPoint | null => {
  if (terminal.cols <= 0 || terminal.rows <= 0) return null;
  const rect = screen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const col = Math.max(
    0,
    Math.min(terminal.cols - 1, Math.floor(((clientX - rect.left) / rect.width) * terminal.cols)),
  );
  const viewportRow = Math.max(
    0,
    Math.min(terminal.rows - 1, Math.floor(((clientY - rect.top) / rect.height) * terminal.rows)),
  );
  return { col, row: terminal.buffer.active.viewportY + viewportRow };
};

export const selectTerminalRange = (
  terminal: TerminalRangeSelection,
  start: TerminalCellPoint,
  end: TerminalCellPoint,
): void => {
  if (terminal.cols <= 0) return;
  const startOffset = start.row * terminal.cols + start.col;
  const endOffset = end.row * terminal.cols + end.col;
  const from = Math.min(startOffset, endOffset);
  const to = Math.max(startOffset, endOffset);
  terminal.select(from % terminal.cols, Math.floor(from / terminal.cols), Math.max(to - from, 1));
};
