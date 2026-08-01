import { describe, expect, it, vi } from "vite-plus/test";
import { createTerminalOutputSession } from "../../../src/lib/terminal-runtime/create-terminal-output-session";
import { WS_OUTPUT_TERMINAL_BROWSER_FRAME } from "../../../src/lib/constants";

const HEADER_BYTES = 9;

const encodeFrame = (width: number, height: number, rgba: Uint8Array) => {
  const out = new Uint8Array(HEADER_BYTES + rgba.length);
  out[0] = WS_OUTPUT_TERMINAL_BROWSER_FRAME;
  new DataView(out.buffer).setUint32(1, width, true);
  new DataView(out.buffer).setUint32(5, height, true);
  out.set(rgba, HEADER_BYTES);
  return out.buffer;
};

describe("terminal-browser frame dispatch", () => {
  it("routes a 0x04 frame to onTerminalBrowserFrame once a compress mode is set", () => {
    const onTerminalBrowserFrame = vi.fn();
    const onOutput = vi.fn();
    const session = createTerminalOutputSession({
      onOutput,
      onOverflow: vi.fn(),
      onReplay: vi.fn(),
      onReplayComplete: vi.fn(),
      onTerminalBrowserFrame,
    });

    session.setCompressMode("br");

    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const frame = encodeFrame(2, 1, rgba);
    session.handleBinaryMessage(frame);

    expect(onOutput).not.toHaveBeenCalled();
    expect(onTerminalBrowserFrame).toHaveBeenCalledOnce();
    const [width, height, pixels] = onTerminalBrowserFrame.mock.calls[0];
    expect(width).toBe(2);
    expect(height).toBe(1);
    expect(Array.from(pixels)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("treats a 0x04-prefixed message as raw output before a compress mode is set", () => {
    const onTerminalBrowserFrame = vi.fn();
    const onOutput = vi.fn();
    const session = createTerminalOutputSession({
      onOutput,
      onOverflow: vi.fn(),
      onReplay: vi.fn(),
      onReplayComplete: vi.fn(),
      onTerminalBrowserFrame,
    });

    const frame = encodeFrame(1, 1, new Uint8Array([1, 2, 3, 4]));
    session.handleBinaryMessage(frame);

    expect(onTerminalBrowserFrame).not.toHaveBeenCalled();
    expect(onOutput).toHaveBeenCalledOnce();
  });
});
