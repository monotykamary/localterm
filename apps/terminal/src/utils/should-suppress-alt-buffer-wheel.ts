import type { Terminal as XtermTerminal } from "@xterm/xterm";

/**
 * In the alt buffer, xterm.js translates wheel events into ↑/↓ arrow key
 * sequences (so `less`/`vim`/etc. respond to wheel without opting into mouse
 * reporting). Trackpads emit `DOM_DELTA_PIXEL` events at ~60 Hz with inertial
 * momentum, so a single flick can fire 30+ wheel events — each one becomes an
 * arrow keypress and the TUI jumps to the top of its list.
 *
 * Drop those pixel-delta wheels before xterm.js sees them. Real mouse wheels
 * report `DOM_DELTA_LINE` (one event per click) and pass through unchanged, so
 * clicky-mouse users still get the wheel→arrow behavior.
 *
 * When the application has enabled mouse reporting (e.g. `?1000h` + `?1006h`
 * for SGR mouse mode), pixel-delta wheel events must NOT be suppressed.
 * xterm.js's `coreMouseService.consumeWheelEvent` already normalizes
 * high-frequency pixel deltas into discrete scroll events by accumulating
 * sub-cell-height deltas and only firing when the threshold is crossed, so
 * the pathological arrow-key spam cannot occur.
 *
 * Normal buffer is untouched — there the wheel scrolls scrollback, which is
 * the whole point and not pathological.
 */
export const shouldSuppressAltBufferWheel = (
  event: WheelEvent,
  terminal: XtermTerminal,
): boolean => {
  if (terminal.buffer.active.type !== "alternate") return false;
  if (terminal.modes.mouseTrackingMode !== "none") return false;
  return event.deltaMode === WheelEvent.DOM_DELTA_PIXEL;
};
