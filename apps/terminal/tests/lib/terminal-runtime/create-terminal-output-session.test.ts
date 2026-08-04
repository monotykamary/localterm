import {
  MAX_OUTPUT_BYTES,
  WS_OUTPUT_CLIENT_QUEUE_MAX_BYTES,
} from "@monotykamary/localterm-server/protocol";
import { describe, expect, it, vi } from "vite-plus/test";
import { createTerminalOutputSession } from "../../../src/lib/terminal-runtime/create-terminal-output-session";

const createSession = () => {
  const onOutput = vi.fn();
  const onOverflow = vi.fn();
  const onReplay = vi.fn();
  const session = createTerminalOutputSession({
    onOutput,
    onOverflow,
    onReplay,
    onReplayComplete: vi.fn(),
  });
  return { session, onOutput, onOverflow, onReplay };
};

describe("createTerminalOutputSession", () => {
  it("closes a raw stream when one frame exceeds the protocol limit", () => {
    const { session, onOutput, onOverflow } = createSession();

    session.handleBinaryMessage(new ArrayBuffer(MAX_OUTPUT_BYTES + 1));

    expect(onOverflow).toHaveBeenCalledOnce();
    expect(onOutput).not.toHaveBeenCalled();
    expect(session.isSuppressingOutput()).toBe(false);
  });

  it("bounds retained replay bytes and ignores work after disposal", () => {
    const { session, onOutput, onOverflow, onReplay } = createSession();
    const frame = new ArrayBuffer(MAX_OUTPUT_BYTES);
    const frameCount = Math.floor(WS_OUTPUT_CLIENT_QUEUE_MAX_BYTES / MAX_OUTPUT_BYTES) + 1;
    session.beginReplay();

    for (let index = 0; index < frameCount; index += 1) {
      session.handleBinaryMessage(frame);
    }
    session.finishReplay();
    session.handleBinaryMessage(new ArrayBuffer(1));

    expect(onOverflow).toHaveBeenCalledOnce();
    expect(onReplay).not.toHaveBeenCalled();
    expect(onOutput).not.toHaveBeenCalled();
  });

  it("keeps unbracketed output on the backward-compatible immediate path", () => {
    const { session, onOutput } = createSession();
    const bytes = Uint8Array.from([1, 2, 3]);

    session.handleBinaryMessage(bytes.buffer);

    expect(onOutput).toHaveBeenCalledOnce();
    expect(Array.from(onOutput.mock.calls[0][0])).toEqual([1, 2, 3]);
  });

  it("commits every piece of a bracketed redraw as one output write", () => {
    const { session, onOutput } = createSession();

    session.beginAtomicOutputFrame();
    session.handleBinaryMessage(Uint8Array.from([1, 2]).buffer);
    session.handleBinaryMessage(Uint8Array.from([3, 4]).buffer);

    expect(onOutput).not.toHaveBeenCalled();

    session.finishAtomicOutputFrame();

    expect(onOutput).toHaveBeenCalledOnce();
    expect(Array.from(onOutput.mock.calls[0][0])).toEqual([1, 2, 3, 4]);
  });

  it("bounds a retained atomic redraw and ignores output after overflow", () => {
    const { session, onOutput, onOverflow } = createSession();
    const frame = new ArrayBuffer(MAX_OUTPUT_BYTES);
    const frameCount = Math.floor(WS_OUTPUT_CLIENT_QUEUE_MAX_BYTES / MAX_OUTPUT_BYTES) + 1;

    session.beginAtomicOutputFrame();
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      session.handleBinaryMessage(frame);
    }
    session.finishAtomicOutputFrame();
    session.handleBinaryMessage(new ArrayBuffer(1));

    expect(onOverflow).toHaveBeenCalledOnce();
    expect(onOutput).not.toHaveBeenCalled();
  });
});
