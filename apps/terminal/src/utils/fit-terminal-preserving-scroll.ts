import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

/**
 * Wraps `fitAddon.fit()` so the user's scrollback position survives the resize.
 *
 * `fit()` calls `terminal.resize()`, which reflows the buffer when the column
 * count changes (lines wrap/unwrap, total row count shifts). xterm.js does not
 * preserve the viewport's distance from the bottom across that reflow, so the
 * user's scroll position visibly jumps to the bottom of the buffer.
 *
 * Strategy: snapshot the viewport's distance from the bottom before fit(), then
 * scroll the same distance up after fit(). If the user was already at the
 * bottom, keep them at the bottom (matches xterm.js's default behavior). If
 * reflow shrank the buffer below the saved distance, the user's exact position
 * is unreachable — fall back to the bottom (xterm's default resize behavior)
 * rather than slamming them to the very top of scrollback, which is jarring
 * and makes random container reflows look like a wild scroll glitch.
 *
 * Returns `true` if the resize was applied, `false` if `fit()` threw (typically
 * an unmeasured container during the very first paint). Callers that need to
 * react to the new dimensions (e.g. send a resize frame upstream) should bail
 * out when this returns `false`.
 *
 * Buffer assumption: we read `terminal.buffer.active` before AND after fit().
 * `fit()` is purely a column/row resize and never toggles the alt screen, so
 * both reads return the same buffer in practice. If a future xterm.js change
 * makes `fit()` cause a buffer swap, the math here would need to snapshot the
 * specific buffer (normal vs alt) explicitly.
 */
export const fitTerminalPreservingScroll = (terminal: Terminal, fitAddon: FitAddon): boolean => {
  const beforeBuffer = terminal.buffer.active;
  const distanceFromBottom = Math.max(0, beforeBuffer.baseY - beforeBuffer.viewportY);
  const wasAtBottom = distanceFromBottom === 0;

  try {
    fitAddon.fit();
  } catch {
    return false;
  }

  try {
    if (wasAtBottom) {
      terminal.scrollToBottom();
      return true;
    }

    const afterBuffer = terminal.buffer.active;
    if (distanceFromBottom > afterBuffer.baseY) {
      terminal.scrollToBottom();
      return true;
    }

    const targetViewportY = afterBuffer.baseY - distanceFromBottom;
    const delta = targetViewportY - afterBuffer.viewportY;
    if (delta !== 0) terminal.scrollLines(delta);
  } catch {
    /* xterm.js shouldn't throw here, but a renderer dispose race could; the
       resize itself already succeeded so we still report true. */
  }

  return true;
};
