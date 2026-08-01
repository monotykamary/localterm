import { describe, expect, it, vi } from "vite-plus/test";
import { createTerminalOutputSession } from "../../../src/lib/terminal-runtime/create-terminal-output-session";
import { WS_OUTPUT_PIXEL_FRAME, WS_OUTPUT_RAW } from "../../../src/lib/constants";

const HEADER_BYTES = 9;

const encodeFrame = (width: number, height: number, rgba: Uint8Array): ArrayBuffer => {
  const out = new Uint8Array(HEADER_BYTES + rgba.length);
  out[0] = WS_OUTPUT_PIXEL_FRAME;
  const view = new DataView(out.buffer);
  view.setUint32(1, width, true);
  view.setUint32(5, height, true);
  out.set(rgba, HEADER_BYTES);
  return out.buffer;
};

const encodeRaw = (bytes: Uint8Array): ArrayBuffer => {
  const out = new Uint8Array(1 + bytes.length);
  out[0] = WS_OUTPUT_RAW;
  out.set(bytes, 1);
  return out.buffer;
};

const makeSession = () => {
  const onOutput = vi.fn();
  const onPixelFrame = vi.fn();
  const onOverflow = vi.fn();
  const session = createTerminalOutputSession({
    onOutput,
    onOverflow,
    onReplay: vi.fn(),
    onReplayComplete: vi.fn(),
    onPixelFrame,
  });
  return { session, onOutput, onPixelFrame, onOverflow };
};

describe("binary framing (pixel frames)", () => {
  it("routes 0x04 frames to onPixelFrame only after the server confirms framing", () => {
    const { session, onOutput, onPixelFrame } = makeSession();
    session.setBinaryFraming(true);

    session.handleBinaryMessage(
      encodeFrame(2, 1, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])),
    );

    expect(onOutput).not.toHaveBeenCalled();
    expect(onPixelFrame).toHaveBeenCalledTimes(1);
    const [width, height, pixels] = onPixelFrame.mock.calls[0];
    expect(width).toBe(2);
    expect(height).toBe(1);
    expect(Array.from(pixels)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("treats a 0x04-prefixed message as data on a legacy raw connection", () => {
    const { session, onOutput, onPixelFrame } = makeSession();

    const bytes = new Uint8Array(encodeFrame(1, 1, new Uint8Array([1, 2, 3, 4])));
    session.handleBinaryMessage(bytes.buffer);

    expect(onPixelFrame).not.toHaveBeenCalled();
    expect(onOutput).toHaveBeenCalledTimes(1);
    expect(Array.from(onOutput.mock.calls[0][0])).toEqual(Array.from(bytes));
  });

  it("reads 0x00-framed raw output when framing is enabled without a compress mode", async () => {
    const { session, onOutput, onPixelFrame } = makeSession();
    session.setBinaryFraming(true);

    session.handleBinaryMessage(encodeRaw(new Uint8Array([104, 105, 106])));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(onPixelFrame).not.toHaveBeenCalled();
    expect(onOutput).toHaveBeenCalledTimes(1);
    expect(Array.from(onOutput.mock.calls[0][0])).toEqual([104, 105, 106]);
  });

  it("rejects a frame whose payload doesn't match its dimensions", () => {
    const { session, onOutput, onPixelFrame } = makeSession();
    session.setBinaryFraming(true);

    const out = new Uint8Array(13);
    out[0] = WS_OUTPUT_PIXEL_FRAME;
    const view = new DataView(out.buffer);
    view.setUint32(1, 10, true);
    view.setUint32(5, 10, true);
    session.handleBinaryMessage(out.buffer);

    expect(onPixelFrame).not.toHaveBeenCalled();
    expect(onOutput).not.toHaveBeenCalled();
  });
});
