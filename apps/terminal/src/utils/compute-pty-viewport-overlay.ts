import type { Terminal } from "@xterm/xterm";

export interface PtyViewportOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PtyViewportOverlay {
  right: PtyViewportOverlayRect | null;
}

// xterm internals: the renderer's CSS cell size. Reading the cell (not the
// canvas) keeps the math stable across the webgl/dom renderers. Cast
// unavoidable — xterm's public types don't expose _renderService.
interface XtermRenderDimensions {
  _core: {
    _renderService: {
      dimensions: { css: { cell: { width: number; height: number } } };
    };
  };
}

export interface ComputePtyViewportOverlayOptions {
  terminal: Terminal;
  effectiveCols: number;
  // The local viewer's natural cols — the viewport's width in cells, ignoring
  // any peer-imposed clamp. The grid is reflowed to effectiveCols (see
  // proposeDimensions in terminal.tsx), so terminal.cols equals effectiveCols
  // and can't gate the mask; instead it fires when the effective size is
  // narrower than what the local viewport could display (effectiveCols <
  // localCols) — i.e. this viewer is the wider peer with dead space to mask.
  localCols: number;
  // The terminal's configured horizontal padding — the gap between the live
  // viewport's right edge and the mask's left edge, so the mask doesn't hug
  // the text. Only the left boundary carries this gap; the mask is flush to
  // the surface's top, right, and bottom (the vertical boundary is the only
  // one that conveys where the active viewport ends).
  paddingX: number;
  // The surface (xterm's positioned parent) rect; returned coords are in the
  // surface's coordinate space (its top-left is 0,0).
  origin: DOMRect;
}

// The PTY only streams into its effective cols×rows — the min across every
// attached client (tmux-style), so a narrower peer (a phone) constrains a
// wider viewer (a desktop). The local grid is reflowed to that effective
// width (terminal.tsx's proposeDimensions clamps xterm to it), so the dead
// columns beyond it are empty page background, not stale wide scrollback.
// This returns the rectangle of that dead area, relative to `origin`, so the
// caller can mask it as inactive chrome.
//
// Only the vertical boundary is masked: a single band to the right of the
// live viewport, flush to the surface's top/right/bottom, with the configured
// horizontal padding as the gap on its left (from the live viewport's right
// edge). The screen is left-aligned (`.xterm-screen { margin: 0 }`), so the
// live viewport sits at the left and the dead area is only on the right. The
// grid keeps the local natural row height, so the live area fills the full
// height regardless of the effective rows — no bottom band.
//
// The mask is gated on the local viewport being wider than the effective size
// (effectiveCols < localCols) — a col count, not a pixel sliver, so a
// sub-pixel gap from cell-width rounding can't render a phantom strip on the
// sole/limiting viewer (where effectiveCols equals localCols → nothing to
// mask).
export const computePtyViewportOverlay = ({
  terminal,
  effectiveCols,
  localCols,
  paddingX,
  origin,
}: ComputePtyViewportOverlayOptions): PtyViewportOverlay => {
  const internals = terminal as unknown as XtermRenderDimensions;
  const cellWidth = internals._core?._renderService?.dimensions?.css?.cell?.width;
  if (!cellWidth || cellWidth <= 0) return { right: null };
  const screen = terminal.element?.querySelector(".xterm-screen");
  if (!(screen instanceof HTMLElement)) return { right: null };
  const screenRect = screen.getBoundingClientRect();

  const hasDeadCols = effectiveCols < localCols;
  if (!hasDeadCols) return { right: null };

  // Clamp the live width to the local viewport: the effective size is the min
  // across clients so it can never exceed the viewer's own cols, but a frame
  // arriving mid-resize can transiently outrun the settled viewport — clamp
  // so the boundary never lands past the live text (and hasDeadCols stays
  // false → no mask).
  const liveWidth = Math.min(effectiveCols, localCols) * cellWidth;
  // The mask's left edge sits one horizontal padding-width right of the live
  // viewport — the only gap, from the mobile viewport. The mask then runs
  // flush to the surface's top, right, and bottom (a full-height band).
  const left = screenRect.left - origin.left + liveWidth + paddingX;
  const width = origin.width - left;
  if (width <= 0) return { right: null };
  return {
    right: {
      left,
      top: 0,
      width,
      height: origin.height,
    },
  };
};
