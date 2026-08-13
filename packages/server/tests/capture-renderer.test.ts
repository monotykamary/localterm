import { describe, expect, it } from "vite-plus/test";
import { CaptureRenderer } from "../src/capture-renderer.js";

const ESC = "\x1b";

describe("CaptureRenderer hibernation", () => {
  it("captures the normal buffer while a TUI owns the alternate buffer", async () => {
    const renderer = new CaptureRenderer(40, 6, 100);
    try {
      renderer.write(`before\r\n$ ${ESC}[?1049hDEAD_TUI_FRAME`);
      await renderer.flush();

      expect(renderer.capture()).toContain("DEAD_TUI_FRAME");
      expect(renderer.captureNormal(100, 10_000)).toBe("before\r\n$ ");
    } finally {
      renderer.dispose();
    }
  });

  it("keeps whole newest rows within both limits", async () => {
    const renderer = new CaptureRenderer(20, 3, 100);
    try {
      renderer.write("one\r\ntwo\r\nthree\r\nfour");
      await renderer.flush();

      expect(renderer.captureNormal(2, 100)).toBe("three\r\nfour");
      expect(renderer.captureNormal(100, 6)).toBe("four");
    } finally {
      renderer.dispose();
    }
  });
});
