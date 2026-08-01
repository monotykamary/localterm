// Full-screen canvas that blits relayed pixel frames (kitty file-medium apps
// like terminal-browser): the daemon relays one opaque RGBA bitmap per frame,
// so a single putImageData per animation frame is the whole render cost; the
// canvas is lazily created on the first frame and cleared when the screen no
// longer represents the frame source.
export interface PixelFrameOverlay {
  applyFrame: (width: number, height: number, rgba: Uint8Array) => void;
  clear: () => void;
  dispose: () => void;
}

export const createPixelFrameOverlay = (container: HTMLElement | null): PixelFrameOverlay => {
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
    canvas.width = frame.width;
    canvas.height = frame.height;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height),
      0,
      0,
    );
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
