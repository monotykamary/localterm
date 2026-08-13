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

  it("retains rendered colors and styles as SGR-only output", async () => {
    const renderer = new CaptureRenderer(80, 1, 100);
    const restored = new CaptureRenderer(80, 1, 100);
    try {
      renderer.write(
        `plain ${ESC}[31mred${ESC}[0m ${ESC}[38;5;202morange${ESC}[0m ` +
          `${ESC}[1;4;38;2;1;2;3;48;2;4;5;6mstyled${ESC}[0m`,
      );
      await renderer.flush();

      const snapshot = renderer.captureNormal(100, 10_000);
      expect(snapshot).toBe(
        `plain ${ESC}[0;31mred${ESC}[0m ${ESC}[0;38;5;202morange${ESC}[0m ` +
          `${ESC}[0;1;4;38;2;1;2;3;48;2;4;5;6mstyled${ESC}[0m`,
      );
      expect(snapshot.replaceAll(/\x1b\[[0-9;]*m/g, "")).toBe("plain red orange styled");
      expect(snapshot.replaceAll(/\x1b\[[0-9;]*m/g, "")).not.toContain(ESC);
      expect(renderer.captureNormal(100, snapshot.length - 1)).toBe("");

      restored.write(snapshot);
      await restored.flush();
      expect(restored.capture()).toBe("plain red orange styled");
      expect(restored.captureNormal(100, 10_000)).toBe(snapshot);
    } finally {
      renderer.dispose();
      restored.dispose();
    }
  });

  it("coalesces parser input and accounts for queued UTF-8 bytes", async () => {
    const renderer = new CaptureRenderer(400, 2, 100);
    try {
      const chunks = Array.from({ length: 300 }, () => "é");
      for (const chunk of chunks) renderer.write(chunk);

      expect(renderer.queuedBytes).toBe(Buffer.byteLength(chunks.join(""), "utf8"));
      await renderer.flush();

      expect(renderer.queuedBytes).toBe(0);
      expect(renderer.capture()).toBe(chunks.join(""));
    } finally {
      renderer.dispose();
    }
  });

  it("releases queued bytes and flush barriers on disposal", async () => {
    const renderer = new CaptureRenderer(80, 2, 100);
    renderer.write("pending".repeat(1_000));
    const flushed = renderer.flush();

    renderer.dispose();

    await flushed;
    expect(renderer.queuedBytes).toBe(0);
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
