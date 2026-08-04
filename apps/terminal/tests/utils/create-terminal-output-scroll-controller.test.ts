import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vite-plus/test";
import { createTerminalOutputScrollController } from "../../src/utils/create-terminal-output-scroll-controller";

interface FakeTerminalBuffer {
  baseY: number;
  type: "normal" | "alternate";
  viewportY: number;
}

interface TerminalScrollHarness {
  buffer: FakeTerminalBuffer;
  controller: ReturnType<typeof createTerminalOutputScrollController>;
  scrollLines: ReturnType<typeof vi.fn>;
  scrollToBottom: ReturnType<typeof vi.fn>;
}

const createTerminalScrollHarness = (initialBuffer: FakeTerminalBuffer): TerminalScrollHarness => {
  const buffer = { ...initialBuffer };
  const scrollLines = vi.fn((amount: number) => {
    buffer.viewportY += amount;
  });
  const scrollToBottom = vi.fn(() => {
    buffer.viewportY = buffer.baseY;
  });
  const terminal = {
    buffer: { active: buffer },
    scrollLines,
    scrollToBottom,
  } as unknown as XtermTerminal;
  return {
    buffer,
    controller: createTerminalOutputScrollController(terminal),
    scrollLines,
    scrollToBottom,
  };
};

describe("createTerminalOutputScrollController", () => {
  it("continues following output when the viewport was at the bottom", () => {
    const harness = createTerminalScrollHarness({ baseY: 100, viewportY: 100, type: "normal" });
    const snapshot = harness.controller.capture();
    harness.buffer.baseY = 105;
    harness.buffer.viewportY = 101;

    harness.controller.restore(snapshot);

    expect(harness.scrollToBottom).toHaveBeenCalledOnce();
    expect(harness.buffer.viewportY).toBe(105);
  });

  it("keeps the same absolute scrollback row visible while detached", () => {
    const harness = createTerminalScrollHarness({ baseY: 100, viewportY: 70, type: "normal" });
    const snapshot = harness.controller.capture();
    harness.buffer.baseY = 105;
    harness.buffer.viewportY = 74;

    harness.controller.restore(snapshot);

    expect(harness.scrollLines).toHaveBeenCalledWith(-4);
    expect(harness.buffer.viewportY).toBe(70);
    expect(harness.scrollToBottom).not.toHaveBeenCalled();
  });

  it("does not overwrite scrolling that happens while output is parsing", () => {
    const harness = createTerminalScrollHarness({ baseY: 100, viewportY: 70, type: "normal" });
    const snapshot = harness.controller.capture();
    harness.buffer.baseY = 105;
    harness.buffer.viewportY = 65;
    harness.controller.noteUserScroll();

    harness.controller.restore(snapshot);

    expect(harness.scrollLines).not.toHaveBeenCalled();
    expect(harness.scrollToBottom).not.toHaveBeenCalled();
    expect(harness.buffer.viewportY).toBe(65);
  });

  it("does not carry a normal-buffer anchor into the alternate buffer", () => {
    const harness = createTerminalScrollHarness({ baseY: 100, viewportY: 70, type: "normal" });
    const snapshot = harness.controller.capture();
    harness.buffer.type = "alternate";
    harness.buffer.baseY = 0;
    harness.buffer.viewportY = 0;

    harness.controller.restore(snapshot);

    expect(harness.scrollLines).not.toHaveBeenCalled();
    expect(harness.scrollToBottom).not.toHaveBeenCalled();
  });
});
