import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vite-plus/test";
import { computePtyViewportOverlay } from "../../src/utils/compute-pty-viewport-overlay";

interface FakeTerminalOptions {
  cellWidth: number;
  // Absolute viewport coords of the live `.xterm-screen` (its left; the
  // function positions the mask off this, not the container).
  screenLeft: number;
}

// A fake terminal exposing only what computePtyViewportOverlay reads: the
// renderer's CSS cell width and a real `.xterm-screen` element whose rect is
// mocked (jsdom doesn't layout, so getBoundingClientRect is stubbed). The
// local grid cols are passed separately as `localCols` — the grid is reflowed
// to effectiveCols, so the function no longer reads terminal.cols.
const createFakeTerminal = ({ cellWidth, screenLeft }: FakeTerminalOptions): Terminal => {
  const element = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  element.appendChild(screen);
  vi.spyOn(screen, "getBoundingClientRect").mockReturnValue(new DOMRect(screenLeft, 0, 0, 0));
  return {
    element,
    _core: {
      _renderService: {
        dimensions: { css: { cell: { width: cellWidth, height: 20 } } },
      },
    },
  } as unknown as Terminal;
};

// origin = a 1000×600 surface at the viewport origin, so returned coords are in
// the surface's own space (its top-left is 0,0).
const ORIGIN = new DOMRect(0, 0, 1000, 600);
// paddingX=16 → the gap between the live viewport's right edge and the mask.
const PADDING_X = 16;
// cell width 10 → the 1000-wide surface holds 100 cols at the screen's left.
const CELL_WIDTH = 10;
// Screen aligned to the surface's left edge (left-aligned, no centering).
const SCREEN_LEFT = 0;

const overlay = (terminal: Terminal, effectiveCols: number, localCols: number) =>
  computePtyViewportOverlay({
    terminal,
    effectiveCols,
    localCols,
    paddingX: PADDING_X,
    origin: ORIGIN,
  });

describe("computePtyViewportOverlay", () => {
  it("renders nothing when the local viewport matches the effective size (limiting/sole viewer)", () => {
    // The regression: a pixel gate rendered a sub-pixel sliver + hairline on
    // the limiting viewer. The col count gate never fires when the local
    // viewport already matches the effective size.
    const terminal = createFakeTerminal({ cellWidth: CELL_WIDTH, screenLeft: SCREEN_LEFT });
    expect(overlay(terminal, 100, 100)).toEqual({ right: null });
  });

  it("masks the dead columns as a full-height band flush to the surface's top, right, and bottom", () => {
    const terminal = createFakeTerminal({ cellWidth: CELL_WIDTH, screenLeft: SCREEN_LEFT });
    // Boundary at text (40×10=400) + the 16px left gap → 416. The band runs
    // from there to the surface right (1000), and the full surface height (0
    // to 600) — no top/right/bottom padding.
    expect(overlay(terminal, 40, 100)).toEqual({
      right: { left: 416, top: 0, width: 584, height: 600 },
    });
  });

  it("clamps a transient effective size that outruns the settled local viewport", () => {
    // A pty-size frame arriving mid-resize can read wider than the local
    // viewport; clamp the live width to localCols so the boundary never lands
    // past the live text (and hasDeadCols stays false → no mask).
    const terminal = createFakeTerminal({ cellWidth: CELL_WIDTH, screenLeft: SCREEN_LEFT });
    expect(overlay(terminal, 120, 40)).toEqual({ right: null });
  });

  it("positions the boundary off the screen rect, so a left offset shifts the mask right", () => {
    // The screen is left-aligned at the container's left inset; any left
    // offset moves the live text right, so the mask boundary must follow the
    // text, not the surface edge.
    const terminal = createFakeTerminal({ cellWidth: CELL_WIDTH, screenLeft: SCREEN_LEFT + 4 });
    // Boundary at (0+4) + 400 + 16 = 420, not 416.
    expect(overlay(terminal, 40, 100)).toEqual({
      right: { left: 420, top: 0, width: 580, height: 600 },
    });
  });

  it("renders nothing when the configured left gap already exceeds the dead width", () => {
    // 1 dead col = 10px; a 20px gap pushes the boundary past the surface
    // right, so there's no room for a band.
    const terminal = createFakeTerminal({ cellWidth: CELL_WIDTH, screenLeft: SCREEN_LEFT });
    const result = computePtyViewportOverlay({
      terminal,
      effectiveCols: 99,
      localCols: 100,
      paddingX: 20,
      origin: ORIGIN,
    });
    // Boundary at 990 + 20 = 1010 > 1000 → width <= 0 → no mask.
    expect(result).toEqual({ right: null });
  });

  it("renders nothing before the first fit (cell size still zero)", () => {
    const terminal = createFakeTerminal({ cellWidth: 0, screenLeft: SCREEN_LEFT });
    expect(overlay(terminal, 40, 100)).toEqual({ right: null });
  });
});
