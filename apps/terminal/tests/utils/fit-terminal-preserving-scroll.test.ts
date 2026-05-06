import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vite-plus/test";
import { fitTerminalPreservingScroll } from "../../src/utils/fit-terminal-preserving-scroll";

interface BufferState {
  baseY: number;
  viewportY: number;
}

const createFakeTerminal = (beforeBuffer: BufferState, afterBuffer: BufferState = beforeBuffer) => {
  let buffer = beforeBuffer;
  const scrollLines = vi.fn();
  const scrollToBottom = vi.fn();
  const swapBuffer = () => {
    buffer = afterBuffer;
  };
  const terminal = {
    get buffer() {
      return { active: { ...buffer } };
    },
    scrollLines,
    scrollToBottom,
  } as unknown as Terminal;
  return { terminal, scrollLines, scrollToBottom, swapBuffer };
};

const createFakeFitAddon = (onFit: () => void = () => {}) => {
  const fit = vi.fn(onFit);
  return { addon: { fit } as unknown as FitAddon, fit };
};

describe("fitTerminalPreservingScroll", () => {
  it("calls fit() and scrolls to bottom when the user was already at the bottom", () => {
    const { terminal, scrollToBottom, scrollLines } = createFakeTerminal({
      baseY: 100,
      viewportY: 100,
    });
    const { addon, fit } = createFakeFitAddon();

    expect(fitTerminalPreservingScroll(terminal, addon)).toBe(true);

    expect(fit).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(scrollLines).not.toHaveBeenCalled();
  });

  it("preserves the distance from the bottom when the user is scrolled up", () => {
    // Before: 30 lines from the bottom (baseY=100, viewportY=70)
    // After fit: baseY shrinks to 80 because reflow widened lines
    // Target: viewportY should land at 80 - 30 = 50, current is 70 → delta = -20
    const { terminal, scrollLines, scrollToBottom, swapBuffer } = createFakeTerminal(
      { baseY: 100, viewportY: 70 },
      { baseY: 80, viewportY: 70 },
    );
    const { addon } = createFakeFitAddon(swapBuffer);

    fitTerminalPreservingScroll(terminal, addon);

    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(scrollLines).toHaveBeenCalledTimes(1);
    expect(scrollLines).toHaveBeenCalledWith(-20);
  });

  it("falls back to scrollToBottom when the new buffer is shorter than the saved distance", () => {
    // Before: 30 lines from bottom on a 100-row buffer
    // After fit: baseY shrinks to 10 (reflow collapsed many lines) — distance > new baseY
    // The saved distance is no longer reachable. Snap to bottom (xterm.js's
    // default resize behavior) instead of jumping to the very top of scrollback.
    const { terminal, scrollLines, scrollToBottom, swapBuffer } = createFakeTerminal(
      { baseY: 100, viewportY: 70 },
      { baseY: 10, viewportY: 5 },
    );
    const { addon } = createFakeFitAddon(swapBuffer);

    fitTerminalPreservingScroll(terminal, addon);

    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(scrollLines).not.toHaveBeenCalled();
  });

  it("does not call scrollLines when the post-fit viewport already lands on the target", () => {
    const { terminal, scrollLines, scrollToBottom, swapBuffer } = createFakeTerminal(
      { baseY: 100, viewportY: 70 },
      { baseY: 80, viewportY: 50 },
    );
    const { addon } = createFakeFitAddon(swapBuffer);

    fitTerminalPreservingScroll(terminal, addon);

    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(scrollLines).not.toHaveBeenCalled();
  });

  it("returns false and never scrolls when fit() throws (container unmeasured)", () => {
    const { terminal, scrollLines, scrollToBottom } = createFakeTerminal({
      baseY: 100,
      viewportY: 70,
    });
    const { addon, fit } = createFakeFitAddon(() => {
      throw new Error("container not measured");
    });

    expect(fitTerminalPreservingScroll(terminal, addon)).toBe(false);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(scrollLines).not.toHaveBeenCalled();
  });

  it("still returns true (resize succeeded) even if scrollLines throws after fit()", () => {
    const { terminal, scrollLines, scrollToBottom, swapBuffer } = createFakeTerminal(
      { baseY: 100, viewportY: 70 },
      { baseY: 80, viewportY: 70 },
    );
    scrollLines.mockImplementation(() => {
      throw new Error("renderer dispose race");
    });
    const { addon } = createFakeFitAddon(swapBuffer);

    expect(fitTerminalPreservingScroll(terminal, addon)).toBe(true);
    expect(scrollLines).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("treats negative baseY-viewportY (impossible but defensive) as 'at bottom'", () => {
    const { terminal, scrollToBottom, scrollLines } = createFakeTerminal({
      baseY: 50,
      viewportY: 60,
    });
    const { addon } = createFakeFitAddon();

    fitTerminalPreservingScroll(terminal, addon);

    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(scrollLines).not.toHaveBeenCalled();
  });
});
