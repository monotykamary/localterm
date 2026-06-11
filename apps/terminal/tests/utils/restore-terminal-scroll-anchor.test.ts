import { describe, expect, it, vi } from "vite-plus/test";
import type { TerminalScrollAnchor } from "../../src/utils/capture-terminal-scroll-anchor";
import { restoreTerminalScrollAnchor } from "../../src/utils/restore-terminal-scroll-anchor";

interface BufferState {
  baseY: number;
  viewportY: number;
}

const createFakeTerminal = (buffer: BufferState) => {
  const scrollLines = vi.fn();
  const scrollToBottom = vi.fn();
  const terminal = {
    buffer: { active: buffer },
    scrollLines,
    scrollToBottom,
  };
  return { terminal, scrollLines, scrollToBottom };
};

describe("restoreTerminalScrollAnchor", () => {
  it("keeps the terminal at the bottom when the anchor was at the bottom", () => {
    const { terminal, scrollLines, scrollToBottom } = createFakeTerminal({
      baseY: 120,
      viewportY: 0,
    });
    const anchor: TerminalScrollAnchor = { distanceFromBottom: 0, wasAtBottom: true };

    restoreTerminalScrollAnchor(terminal, anchor);

    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(scrollLines).not.toHaveBeenCalled();
  });

  it("preserves distance from the bottom when replayed scrollback is long enough", () => {
    const { terminal, scrollLines, scrollToBottom } = createFakeTerminal({
      baseY: 80,
      viewportY: 70,
    });
    const anchor: TerminalScrollAnchor = { distanceFromBottom: 30, wasAtBottom: false };

    restoreTerminalScrollAnchor(terminal, anchor);

    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(scrollLines).toHaveBeenCalledWith(-20);
  });

  it("uses the closest reachable viewport when replayed scrollback is shorter", () => {
    const { terminal, scrollLines, scrollToBottom } = createFakeTerminal({
      baseY: 10,
      viewportY: 5,
    });
    const anchor: TerminalScrollAnchor = { distanceFromBottom: 30, wasAtBottom: false };

    restoreTerminalScrollAnchor(terminal, anchor);

    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(scrollLines).not.toHaveBeenCalled();
  });
});
