import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { outputBatcher } from "@/utils/write-terminal-output";

interface TerminalPtySize {
  cols: number;
  rows: number;
}

interface InstallTerminalScrollbarOptions {
  terminal: XtermTerminal;
  fitAddon: FitAddon;
  naturalColsRef: RefObject<number | null>;
  ptySizeRef: RefObject<TerminalPtySize | null>;
  scrollbarTrackRef: RefObject<HTMLDivElement | null>;
  scrollbarThumbRef: RefObject<HTMLDivElement | null>;
  setPtyViewportVersion: Dispatch<SetStateAction<number>>;
}

interface TerminalScrollbar {
  update: () => void;
  dispose: () => void;
}

export const installTerminalScrollbar = ({
  terminal,
  fitAddon,
  naturalColsRef,
  ptySizeRef,
  scrollbarTrackRef,
  scrollbarThumbRef,
  setPtyViewportVersion,
}: InstallTerminalScrollbarOptions): TerminalScrollbar => {
  const patchFitAddonScrollbarWidth = () => {
    if (!fitAddon.proposeDimensions) return;
    fitAddon.proposeDimensions = () => {
      if (!terminal || !terminal.element || !terminal.element.parentElement) return undefined;
      const terminalInternals = terminal as unknown as {
        _core: {
          _renderService: {
            dimensions: { css: { cell: { width: number; height: number } } };
          };
        };
      };
      const cellWidth = terminalInternals._core._renderService.dimensions.css.cell.width;
      const cellHeight = terminalInternals._core._renderService.dimensions.css.cell.height;
      if (cellWidth === 0 || cellHeight === 0) return undefined;
      const parentStyle = window.getComputedStyle(terminal.element.parentElement);
      const elementStyle = window.getComputedStyle(terminal.element);
      const availableWidth =
        Math.max(0, parseInt(parentStyle.getPropertyValue("width"))) -
        (parseInt(elementStyle.getPropertyValue("padding-right")) +
          parseInt(elementStyle.getPropertyValue("padding-left")));
      const availableHeight =
        parseInt(parentStyle.getPropertyValue("height")) -
        (parseInt(elementStyle.getPropertyValue("padding-top")) +
          parseInt(elementStyle.getPropertyValue("padding-bottom")));
      const naturalCols = Math.max(2, Math.floor(availableWidth / cellWidth));
      const naturalRows = Math.max(1, Math.floor(availableHeight / cellHeight));
      // Stash the natural cols so sendResize reports them (not the clamped
      // grid) and the overlay gates the mask on natural-vs-effective.
      naturalColsRef.current = naturalCols;
      // Reflow the local grid to the PTY's effective cols when a narrower peer
      // constrains it: xterm reflows the whole buffer on resize, so the dead
      // columns beyond the effective width carry no stale wide content (a
      // narrow phone joining a wide desktop otherwise leaves the desktop's
      // pre-join 120-col scrollback sitting in cols 40-120, bleeding through
      // the mask). Rows stay at the local natural height — only the vertical
      // boundary conveys anything, and clamping rows would shrink the
      // terminal instead of masking the side.
      const effectiveCols = ptySizeRef.current?.cols;
      const cols = effectiveCols ? Math.min(naturalCols, effectiveCols) : naturalCols;
      return { cols, rows: naturalRows };
    };
  };
  patchFitAddonScrollbarWidth();

  const updateScrollbar = () => {
    const buffer = terminal.buffer.active;
    const totalLines = buffer.length;
    const visibleLines = terminal.rows;
    const isAtBottom = buffer.viewportY + visibleLines >= totalLines;
    const hasScrollback = totalLines > visibleLines;

    const track = scrollbarTrackRef.current;
    const thumb = scrollbarThumbRef.current;
    if (!track || !thumb) return;

    track.classList.toggle("xterm-scrollbar-visible", !isAtBottom && hasScrollback);

    if (hasScrollback) {
      const thumbHeightRatio = visibleLines / totalLines;
      const thumbTopRatio = buffer.viewportY / totalLines;
      thumb.style.height = `${thumbHeightRatio * 100}%`;
      thumb.style.top = `${thumbTopRatio * 100}%`;
    }
  };
  updateScrollbar();
  const scrollDisposable = terminal.onScroll(updateScrollbar);
  outputBatcher.setAfterFlush(updateScrollbar);
  // A grid/cell-size change (window resize, font, padding, fit) moves the
  // `.xterm-screen` rect the pty-viewport mask is positioned off, so re-measure
  // on resize. onResize fires before the DOM settles, so defer to the next
  // frame for an accurate getBoundingClientRect.
  const ptyViewportResizeDisposable = terminal.onResize(() => {
    requestAnimationFrame(() => setPtyViewportVersion((version) => version + 1));
  });

  let isDragging = false;
  let dragStartY = 0;
  let dragStartViewportY = 0;

  const handleThumbPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    isDragging = true;
    dragStartY = event.clientY;
    dragStartViewportY = terminal.buffer.active.viewportY;
    try {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture not available */
    }
    event.preventDefault();
  };

  const handleThumbPointerMove = (event: PointerEvent) => {
    if (!isDragging) return;
    const trackEl = scrollbarTrackRef.current;
    if (!trackEl) return;
    const trackHeight = trackEl.clientHeight;
    const buffer = terminal.buffer.active;
    const totalLines = buffer.length - terminal.rows;
    if (totalLines <= 0 || trackHeight <= 0) return;
    const pixelsPerLine = trackHeight / totalLines;
    const deltaY = event.clientY - dragStartY;
    const targetViewportY = Math.max(
      0,
      Math.min(totalLines, dragStartViewportY + Math.round(deltaY / pixelsPerLine)),
    );
    if (targetViewportY !== terminal.buffer.active.viewportY) {
      terminal.scrollLines(targetViewportY - terminal.buffer.active.viewportY);
    }
  };

  const handleThumbPointerUp = () => {
    isDragging = false;
  };

  const handleTrackPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (event.target === scrollbarThumbRef.current) return;
    const trackEl = scrollbarTrackRef.current;
    if (!trackEl) return;
    const trackRect = trackEl.getBoundingClientRect();
    const clickRatio = (event.clientY - trackRect.top) / trackRect.height;
    const buffer = terminal.buffer.active;
    const totalLines = buffer.length;
    const targetViewportY = Math.max(
      0,
      Math.min(
        totalLines - terminal.rows,
        Math.round(clickRatio * totalLines) - Math.floor(terminal.rows / 2),
      ),
    );
    terminal.scrollLines(targetViewportY - buffer.viewportY);
  };

  const thumbEl = scrollbarThumbRef.current;
  const trackEl = scrollbarTrackRef.current;
  if (thumbEl) {
    thumbEl.addEventListener("pointerdown", handleThumbPointerDown);
    thumbEl.addEventListener("pointermove", handleThumbPointerMove);
    thumbEl.addEventListener("pointerup", handleThumbPointerUp);
    thumbEl.addEventListener("pointercancel", handleThumbPointerUp);
  }
  if (trackEl) {
    trackEl.addEventListener("pointerdown", handleTrackPointerDown);
  }

  return {
    update: updateScrollbar,
    dispose: () => {
      if (thumbEl) {
        thumbEl.removeEventListener("pointerdown", handleThumbPointerDown);
        thumbEl.removeEventListener("pointermove", handleThumbPointerMove);
        thumbEl.removeEventListener("pointerup", handleThumbPointerUp);
        thumbEl.removeEventListener("pointercancel", handleThumbPointerUp);
      }
      if (trackEl) trackEl.removeEventListener("pointerdown", handleTrackPointerDown);
      scrollDisposable.dispose();
      ptyViewportResizeDisposable.dispose();
    },
  };
};
