import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  OUTPUT_BATCH_FLUSH_BYTES,
  OUTPUT_BATCH_WINDOW_MS,
  OUTPUT_STREAM_THRESHOLD_MS,
  RENDERER_PENDING_PAUSE_HIGH_WATER_BYTES,
  RENDERER_PENDING_RESUME_LOW_WATER_BYTES,
  WS_OUTBOUND_DRAIN_POLL_MS,
  WS_OUTPUT_PIXEL_FRAME,
  WS_OUTPUT_FRAME_HEADER_BYTES,
  WS_READY_STATE_OPEN,
} from "../src/constants.js";
import type { CaptureRenderer } from "../src/capture-renderer.js";
import { SessionOutputCoordinator } from "../src/session-output-coordinator.js";
import { SessionOutputTransport } from "../src/session-output-transport.js";
import type { ManagedClient, ManagedSession } from "../src/session-manager.js";
import { createSynchronizedOutputEndDetector } from "../src/utils/create-synchronized-output-end-detector.js";

const ESC = "\x1b";
const encode = (value: string) => Buffer.from(value).toString("base64");
describe("SessionOutputCoordinator", () => {
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
      pendingQueue: [],
      pendingBytesLength: 0,
      pendingControlMessageCount: 0,
      pendingOverflowed: false,
    } as unknown as ManagedClient;
    const session = {
      pid: 1234,
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
    };
    session.pause.mockImplementation(() => {
      session.isPaused = true;
    });
    session.resume.mockImplementation(() => {
      session.isPaused = false;
    });
    const managed = {
      id: "test-session",
      owner: null,
      clients: new Set([client]),
      session,
      synchronizedOutputEndDetector: createSynchronizedOutputEndDetector(),
      outputBatch: "",
      outputBatchTimer: null,
      outputBurstStartedAtMs: null,
      outputBurstIsStream: false,
      atomicOutputFrameOpen: false,
      automation: null,
      automationLog: "",
      captureRenderer: undefined,
      hibernateRenderer: undefined,
      drainPollTimer: null,
      lastOutputAt: 0,
    } as unknown as ManagedSession;
    return { managed, client, sent, session };
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
    return { coordinator, sendControl, writeInput };
  };

  it("pauses the PTY until the hibernation renderer backlog drains", async () => {
    vi.useFakeTimers();
    const { managed, session } = makeSession(true);
    const rendererBacklog = { queuedBytes: RENDERER_PENDING_PAUSE_HIGH_WATER_BYTES };
    managed.hibernateRenderer = rendererBacklog as unknown as CaptureRenderer;
    const { coordinator } = makeCoordinator();
    try {
      managed.outputBatch = "output";
      coordinator.flushOutput(managed);

      expect(session.pause).toHaveBeenCalledTimes(1);
      expect(session.isPaused).toBe(true);

      rendererBacklog.queuedBytes = RENDERER_PENDING_RESUME_LOW_WATER_BYTES + 1;
      await vi.advanceTimersByTimeAsync(WS_OUTBOUND_DRAIN_POLL_MS);
      expect(session.resume).not.toHaveBeenCalled();

      rendererBacklog.queuedBytes = RENDERER_PENDING_RESUME_LOW_WATER_BYTES;
      await vi.advanceTimersByTimeAsync(WS_OUTBOUND_DRAIN_POLL_MS);
      expect(session.resume).toHaveBeenCalledTimes(1);
      expect(session.isPaused).toBe(false);
      expect(managed.drainPollTimer).toBeNull();
    } finally {
      coordinator.stopDrainPoll(managed);
      vi.useRealTimers();
    }
  });

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

  it("brackets a size-split redraw until its idle boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const { managed, sent } = makeSession(true);
      const { coordinator, sendControl } = makeCoordinator();

      await coordinator.onSessionOutput(managed, "a".repeat(OUTPUT_BATCH_FLUSH_BYTES));

      expect(sent).toHaveLength(1);
      expect(sendControl.mock.calls.map((call) => call[1].type)).toEqual(["output-frame-start"]);

      await coordinator.onSessionOutput(managed, "tail");
      await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_WINDOW_MS);

      expect(sent).toHaveLength(2);
      expect(sendControl.mock.calls.map((call) => call[1].type)).toEqual([
        "output-frame-start",
        "output-frame-end",
      ]);
      expect(managed.atomicOutputFrameOpen).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a sustained stream after the redraw threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    try {
      const { managed } = makeSession(true);
      const { coordinator, sendControl } = makeCoordinator();
      const outputChunk = "s".repeat(OUTPUT_BATCH_FLUSH_BYTES);

      await coordinator.onSessionOutput(managed, outputChunk);
      vi.setSystemTime(2_000 + OUTPUT_STREAM_THRESHOLD_MS);
      await coordinator.onSessionOutput(managed, outputChunk);
      await coordinator.onSessionOutput(managed, outputChunk);

      expect(sendControl.mock.calls.map((call) => call[1].type)).toEqual([
        "output-frame-start",
        "output-frame-end",
      ]);
      expect(managed.outputBurstIsStream).toBe(true);
      coordinator.finishOutputBurst(managed);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a long synchronized redraw atomic until DECRST 2026", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000);
    try {
      const { managed } = makeSession(true);
      const { coordinator, sendControl } = makeCoordinator();
      const outputChunk = "x".repeat(OUTPUT_BATCH_FLUSH_BYTES);

      await coordinator.onSessionOutput(managed, `\x1b[?2026h${outputChunk}`);
      vi.setSystemTime(3_000 + OUTPUT_STREAM_THRESHOLD_MS * 2);
      await coordinator.onSessionOutput(managed, outputChunk);

      expect(managed.outputBurstIsStream).toBe(false);
      expect(sendControl.mock.calls.map((call) => call[1].type)).toEqual(["output-frame-start"]);

      await coordinator.onSessionOutput(managed, "\x1b[?2026l");

      expect(sendControl.mock.calls.map((call) => call[1].type)).toEqual([
        "output-frame-start",
        "output-frame-end",
      ]);
      expect(managed.atomicOutputFrameOpen).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
