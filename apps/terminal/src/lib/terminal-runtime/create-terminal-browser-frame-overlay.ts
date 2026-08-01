// Full-screen canvas that blits relayed terminal-browser RGBA frames. Unlike
// the image addon's cell-grid tiling, terminal-browser frames are one opaque
// pixels array placed at absolute screen coordinates, so a single putImageData
// per animation frame is the whole render cost. Lazily created on the first
// frame and cleared/removed when the screen no longer represents terminal-browser.
export interface TerminalBrowserFrameOverlay {
  applyFrame: (width: number, height: number, rgba: Uint8Array) => void;
  clear: () => void;
  dispose: () => void;
}

export const createTerminalBrowserFrameOverlay = (
  container: HTMLElement | null,
): TerminalBrowserFrameOverlay => {
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let pending: { width: number; height: number; rgba: Uint8Array } | null = null;
  let frameRequest = 0;

  const ensureCanvas = (): void => {
    if (canvas || !container) return;
    const screen = container.querySelector(".xterm-screen");
    if (!(screen instanceof HTMLElement)) return;
    canvas = document.createElement("canvas");
    context = canvas.getContext("2d");
    if (!context) {
      canvas = null;
      return;
    }
    Object.assign(canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      zIndex: "50",
      pointerEvents: "none",
    });
    screen.appendChild(canvas);
  };

  const draw = (): void => {
    frameRequest = 0;
    const frame = pending;
    if (!frame || !canvas || !context) return;
    pending = null;
    const { width, height, rgba } = frame;
    canvas.width = width;
    canvas.height = height;
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  };

  return {
    applyFrame: (width, height, rgba) => {
      ensureCanvas();
      pending = { width, height, rgba };
      if (!frameRequest) frameRequest = requestAnimationFrame(draw);
    },
    clear: () => {
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    },
    dispose: () => {
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      pending = null;
      canvas?.remove();
      canvas = null;
      context = null;
    },
  };
};
