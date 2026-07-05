import type { IBufferCell, Terminal } from "@xterm/headless";

// Serialize a headless terminal's visible viewport to an ANSI byte stream
// that, when written to a viewer's xterm, reproduces the viewport cells
// (colors, attributes, wide chars) and repositions the cursor — a faithful
// ~rows×cols "screenshot" the client paints in one write. This is the
// render-skip payload: when the uplink can't keep up with a megabyte TUI
// redraw, the server sends this compact viewport snapshot instead of the
// raw burst, so the viewer sees the latest state in one paint instead of a
// top-to-bottom crawl.
//
// The output is `ESC[2J` (clear the visible screen; the scrollback above is
// untouched) then one cursor-positioned row of cells at a time, emitting SGR
// only when a cell's attributes change from the previous one (per-span, not
// per-cell), then the cursor moved to its viewport position. SGR state is
// reset before the first differing cell so the snapshot is independent of
// whatever the viewer's terminal carried from prior output. Cursor visibility
// and alt-screen entry are intentionally NOT set here — the viewer already
// tracks those from the live mode-set sequences, so restating them would risk
// desyncing from the PTY's actual mode state.

const CSI = "\x1b[";

const positionCursor = (row: number, col: number): string => `${CSI}${row};${col}H`;

// Build the SGR parameter list for a cell's foreground, background, and
// attributes (bold/dim/italic/underline/blink/inverse/invisible/strikethrough/
// overline). Palette colors 0-15 use the compact 16-color SGR (30-37 / 90-97
// for fg, 40-47 / 100-107 for bg); 16-255 use `38;5;n` / `48;5;n`; RGB uses
// `38;2;r;g;b` / `48;2;r;g;b`. Default fg/bg are 39 / 49.
const buildSgrParams = (cell: IBufferCell): string[] => {
  const params: string[] = [];
  if (cell.isBold()) params.push("1");
  if (cell.isDim()) params.push("2");
  if (cell.isItalic()) params.push("3");
  if (cell.isUnderline()) params.push("4");
  if (cell.isBlink()) params.push("5");
  if (cell.isInverse()) params.push("7");
  if (cell.isInvisible()) params.push("8");
  if (cell.isStrikethrough()) params.push("9");
  if (cell.isOverline()) params.push("53");

  if (cell.isFgDefault()) {
    params.push("39");
  } else if (cell.isFgPalette()) {
    const color = cell.getFgColor();
    if (color < 8) params.push(String(30 + color));
    else if (color < 16) params.push(String(90 + (color - 8)));
    else params.push(`38;5;${color}`);
  } else if (cell.isFgRGB()) {
    const color = cell.getFgColor();
    params.push(`38;2;${(color >> 16) & 0xff};${(color >> 8) & 0xff};${color & 0xff}`);
  }

  if (cell.isBgDefault()) {
    params.push("49");
  } else if (cell.isBgPalette()) {
    const color = cell.getBgColor();
    if (color < 8) params.push(String(40 + color));
    else if (color < 16) params.push(String(100 + (color - 8)));
    else params.push(`48;5;${color}`);
  } else if (cell.isBgRGB()) {
    const color = cell.getBgColor();
    params.push(`48;2;${(color >> 16) & 0xff};${(color >> 8) & 0xff};${color & 0xff}`);
  }

  return params;
};

// `line.getCell(x)` without a reusable cell allocates per call; for a one-shot
// snapshot on a backpressure burst (not the hot output path) that's fine, and
// it keeps the read loop free of cell-lifecycle plumbing.
export const serializeViewport = (terminal: Terminal): string => {
  const buffer = terminal.buffer.active;
  const rows = terminal.rows;
  const cols = terminal.cols;
  const top = buffer.baseY;

  const parts: string[] = [`${CSI}2J`, `${CSI}0m`];

  let prev: IBufferCell | null = null;
  for (let row = 0; row < rows; row += 1) {
    const line = buffer.getLine(top + row);
    parts.push(positionCursor(row + 1, 1));
    if (!line) {
      prev = null;
      continue;
    }
    for (let col = 0; col < cols; col += 1) {
      const cell = line.getCell(col);
      if (!cell) continue;
      if (cell.getWidth() === 0) continue; // wide-char spacer — cursor already past it
      if (prev === null || !cell.attributesEquals(prev)) {
        const params = buildSgrParams(cell);
        parts.push(params.length === 0 ? `${CSI}0m` : `${CSI}0;${params.join(";")}m`);
      }
      const chars = cell.getChars();
      parts.push(chars.length === 0 ? " " : chars);
      prev = cell;
    }
  }

  parts.push(`${CSI}0m`);
  // cursorY is viewport-relative (0..rows-1); cursorX is 0..cols. ANSI is 1-based.
  const cursorRow = buffer.cursorY + 1;
  const cursorCol = Math.min(buffer.cursorX, cols) + 1;
  parts.push(positionCursor(cursorRow, cursorCol));
  return parts.join("");
};
