import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { installTerminalScrollbar } from "../../src/utils/install-terminal-scrollbar";
import { outputBatcher } from "../../src/utils/write-terminal-output";

interface TerminalDimensionRefs {
  naturalColsRef: { current: number | null };
  naturalRowsRef: { current: number | null };
}

const createTerminalDimensionHarness = () => {
  const parent = document.createElement("div");
  const element = document.createElement("div");
  parent.style.width = "1000px";
  parent.style.height = "600px";
  element.style.padding = "10px";
  parent.append(element);
  document.body.append(parent);

  const terminal = {
    _core: {
      _renderService: {
        dimensions: { css: { cell: { width: 10, height: 20 } } },
      },
    },
    buffer: { active: { length: 24, viewportY: 0 } },
    element,
    rows: 24,
    onResize: () => ({ dispose: vi.fn() }),
    onScroll: () => ({ dispose: vi.fn() }),
  } as unknown as XtermTerminal;
  const fitAddon = { proposeDimensions: () => undefined } as unknown as FitAddon;
  const refs: TerminalDimensionRefs = {
    naturalColsRef: { current: null },
    naturalRowsRef: { current: null },
  };
  const scrollbar = installTerminalScrollbar({
    terminal,
    fitAddon,
    ...refs,
    ptySizeRef: { current: { cols: 40, rows: 12 } },
    scrollbarTrackRef: { current: null },
    scrollbarThumbRef: { current: null },
    setPtyViewportVersion: vi.fn(),
    onUserScroll: vi.fn(),
  });
  return { fitAddon, refs, scrollbar };
};

describe("installTerminalScrollbar dimensions", () => {
  afterEach(() => {
    document.body.replaceChildren();
    outputBatcher.setAfterFlush(null);
  });

  it("retains both natural axes while clamping only the rendered columns", () => {
    const { fitAddon, refs, scrollbar } = createTerminalDimensionHarness();

    expect(fitAddon.proposeDimensions?.()).toEqual({ cols: 40, rows: 29 });
    expect(refs.naturalColsRef.current).toBe(98);
    expect(refs.naturalRowsRef.current).toBe(29);

    scrollbar.dispose();
  });
});
