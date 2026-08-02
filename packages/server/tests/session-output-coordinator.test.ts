import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  WS_OUTPUT_PIXEL_FRAME,
  WS_OUTPUT_FRAME_HEADER_BYTES,
  WS_READY_STATE_OPEN,
} from "../src/constants.js";
import { SessionOutputCoordinator } from "../src/session-output-coordinator.js";
import { SessionOutputTransport } from "../src/session-output-transport.js";
import type { ManagedClient, ManagedSession } from "../src/session-manager.js";
import { createSynchronizedOutputEndDetector } from "../src/utils/create-synchronized-output-end-detector.js";

const ESC = "\x1b";
const encode = (value: string) => Buffer.from(value).toString("base64");
describe("SessionOutputCoordinator kitty file-medium handling", () => {
  const tmpdir = process.env.TMPDIR || os.tmpdir();

  const makeSession = (framingEnabled: boolean) => {
    const sent: Uint8Array[] = [];
    const client = {
      pending: false,
      framingEnabled,
      compressMode: null,
      ws: {
        readyState: WS_READY_STATE_OPEN,
        send: (raw: string | ArrayBuffer | Uint8Array) => {
          if (typeof raw === "string") return;
          sent.push(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
        },
        close: () => undefined,
      },
      pendingBytes: [],
      pendingBytesLength: 0,
      pendingControl: [],
      pendingOverflowed: false,
    } as unknown as ManagedClient;
    const managed = {
      id: "test-session",
      owner: null,
      clients: new Set([client]),
      session: { pid: 1234, isPaused: false },
      synchronizedOutputEndDetector: createSynchronizedOutputEndDetector(),
      outputBatch: "",
      outputBatchTimer: null,
      automation: null,
      automationLog: "",
      captureRenderer: undefined,
      drainPollTimer: null,
      lastOutputAt: 0,
    } as unknown as ManagedSession;
    return { managed, client, sent };
  };

  const makeCoordinator = () => {
    const writeInput = vi.fn();
    const sendControl = vi.fn();
    const transport = new SessionOutputTransport(sendControl);
    const coordinator = new SessionOutputCoordinator({
      outputTransport: transport,
      noteOutputActivity: () => undefined,
      onOutputActivity: () => undefined,
      writeInput,
    });
    return { coordinator, writeInput };
  };

  it("answers a file-medium probe with OK for framed viewers", async () => {
    const probeFile = path.join(tmpdir, "kitty-probe-ok.rgba");
    fs.writeFileSync(probeFile, Buffer.alloc(4, 1));
    const { managed } = makeSession(true);
    const { coordinator, writeInput } = makeCoordinator();
    const text = `${ESC}_Gi=300,a=q,t=f,f=32,s=1,v=1;${encode(probeFile)}${ESC}\\`;
    await coordinator.onSessionOutput(managed, text);
    expect(writeInput).toHaveBeenCalledTimes(1);
    expect(writeInput.mock.calls[0][1]).toBe(`${ESC}_Gi=300;OK${ESC}\\`);
    fs.rmSync(probeFile, { force: true });
  });

  it("does not answer probes when a viewer lacks binary framing", async () => {
    const probeFile = path.join(tmpdir, "kitty-probe-skip.rgba");
    fs.writeFileSync(probeFile, Buffer.alloc(4, 1));
    const { managed } = makeSession(false);
    const { coordinator, writeInput } = makeCoordinator();
    const text = `${ESC}_Gi=300,a=q,t=f,f=32,s=1,v=1;${encode(probeFile)}${ESC}\\`;
    await coordinator.onSessionOutput(managed, text);
    expect(writeInput).not.toHaveBeenCalled();
    fs.rmSync(probeFile, { force: true });
  });

  it("relays a frame transmit as a 0x04 binary WS message", async () => {
    const frameFile = path.join(tmpdir, "kitty-frame-relay.rgba");
    fs.writeFileSync(frameFile, Buffer.alloc(4 * 2 * 4, 3));
    const { managed, sent } = makeSession(true);
    const { coordinator } = makeCoordinator();
    const text = `${ESC}_Ga=T,f=32,s=4,v=2,t=f,i=9,q=2;${encode(frameFile)}${ESC}\\`;
    await coordinator.onSessionOutput(managed, text);
    const frame = sent.find((bytes) => bytes[0] === WS_OUTPUT_PIXEL_FRAME);
    expect(frame).toBeDefined();
    if (!frame) throw new Error("missing frame");
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint32(1, true)).toBe(4);
    expect(view.getUint32(5, true)).toBe(2);
    expect(frame.byteLength).toBe(WS_OUTPUT_FRAME_HEADER_BYTES + 4 * 2 * 4);
    fs.rmSync(frameFile, { force: true });
  });
});
