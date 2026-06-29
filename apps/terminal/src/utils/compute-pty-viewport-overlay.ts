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
// wider viewer (a desktop). xterm's own grid is the *local* viewer's size,
// which can be wider, leaving dead columns to the right filled with empty
// terminal background that reads as usable space. This returns the rectangle
// of that dead area, relative to `origin`, so the caller can mask it as
// inactive chrome.
//
// Only the vertical boundary is masked: a single band to the right of the
// live viewport, flush to the surface's top/right/bottom, with the configured
// horizontal padding as the gap on its left (from the live viewport's right
// edge). Dead rows below the live viewport are left unmasked — the horizontal
// boundary conveys nothing the vertical one doesn't, and a phone with the
// keyboard down is often taller than the desktop (so the desktop is the
// row-limiter) and masking the phone's own bottom read as a bleed and wasted
// its limited vertical space.
//
// The mask is gated on the local grid being wider than the effective size — a
// col count, not a pixel sliver. xterm centers its screen with `margin: 0
// auto`, so the screen's right edge can sit a sub-pixel inside the container; a
// pixel gate would render a phantom 0.5px strip plus a 1px hairline on the
// limiting viewer (the phone, or a desktop after its peer leaves and the stale
// pty-size still reads narrower than the local grid). The count gate never
// fires when the local grid already matches the effective size (sole/limiting
// viewer → nothing to mask).
export const computePtyViewportOverlay = ({
  terminal,
  effectiveCols,
  paddingX,
  origin,
}: ComputePtyViewportOverlayOptions): PtyViewportOverlay => {
  const internals = terminal as unknown as XtermRenderDimensions;
  const cellWidth = internals._core?._renderService?.dimensions?.css?.cell?.width;
  if (!cellWidth || cellWidth <= 0) return { right: null };
  const screen = terminal.element?.querySelector(".xterm-screen");
  if (!(screen instanceof HTMLElement)) return { right: null };
  const screenRect = screen.getBoundingClientRect();

  const hasDeadCols = effectiveCols < terminal.cols;
  if (!hasDeadCols) return { right: null };

  // Clamp the live width to the local grid: the effective size is the min
  // across clients so it can never exceed the viewer's own cols, but a frame
  // arriving mid-resize can transiently outrun the settled grid — clamp so the
  // boundary never lands past the live text.
  const liveWidth = Math.min(effectiveCols, terminal.cols) * cellWidth;
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
