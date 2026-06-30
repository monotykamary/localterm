// SGR-1006 mouse sequence encoder — the fallback path when no browser/CDP tab
// is available to dispatch a real mouse event through xterm.js. Writes the
// sequences directly to the PTY master. Cols/rows are 1-indexed per the SGR
// spec. Button codes: 0/1/2 = left/middle/right press; +32 during motion
// (drag/hover); 64/65 = wheel up/down. Press ends with `M`, release with `m`.
//
// Only written when the session's terminal mode tracker confirms a mouse mode
// is enabled (the caller gates on that) — otherwise the bytes would land in the
// app's stdin as typed text. xterm.js handles this gating itself in the CDP
// path; this encoder is the true-headless fallback.

const ESC = "\x1b";

const BUTTON_CODE = { left: 0, middle: 1, right: 2 } as const;

type MouseButton = keyof typeof BUTTON_CODE;

const sgr = (button: number, col: number, row: number, release: boolean): string =>
  `${ESC}[<${button};${col};${row}${release ? "m" : "M"}`;

// A click: press then release at (col,row). `clicks` > 1 sets the repeat count
// on each event so xterm/the app recognizes a double/triple click.
const encodeClick = (col: number, row: number, button: MouseButton, clicks: number): string => {
  const code = BUTTON_CODE[button];
  const down = sgr(code, col, row, false);
  const up = sgr(code, col, row, true);
  if (clicks <= 1) return down + up;
  return down.repeat(clicks) + up;
};

// A drag: press at from, move to to with the button held (motion = button+32),
// release at to.
const encodeDrag = (
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  button: MouseButton,
): string => {
  const code = BUTTON_CODE[button];
  const press = sgr(code, fromCol, fromRow, false);
  const motion = sgr(code + 32, toCol, toRow, false);
  const release = sgr(code, toCol, toRow, true);
  return press + motion + release;
};

// A hover/move with no button held: motion code 35 (3+32) — only meaningful when
// the app enabled motion tracking (?1002/?1003).
const encodeMove = (col: number, row: number): string => sgr(35, col, row, false);

// A scroll: wheel events are button 64 (up) / 65 (down), always `M`. `amount`
// repeats the event.
const encodeScroll = (col: number, row: number, direction: "up" | "down", amount: number): string =>
  sgr(direction === "up" ? 64 : 65, col, row, false).repeat(Math.max(1, amount));

export { encodeClick, encodeDrag, encodeMove, encodeScroll };
export type { MouseButton };
