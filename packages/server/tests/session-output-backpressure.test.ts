import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionOutputCoordinator } from "../src/session-output-coordinator.js";
import { SessionOutputTransport } from "../src/session-output-transport.js";
import type { ManagedClient, ManagedSession } from "../src/session-manager.js";
import type { CaptureRenderer } from "../src/capture-renderer.js";
import type { KittyApcOutputPart } from "../src/kitty-apc-scanner.js";
import { createSynchronizedOutputEndDetector } from "../src/utils/create-synchronized-output-end-detector.js";
import {
  OUTPUT_BATCH_FLUSH_BYTES,
  RENDERER_PENDING_PAUSE_HIGH_WATER_BYTES,
  RENDERER_PENDING_RESUME_LOW_WATER_BYTES,
  WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES,
  WS_OUTBOUND_DRAIN_POLL_MS,
} from "../src/constants.js";

describe("file-output backpressure", () => {
  let root: string;
  let sequence: string;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    root = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-output-pressure-"));
    const file = path.join(root, "pixel.rgba");
    fs.writeFileSync(file, Buffer.alloc(4));
    sequence = `\x1b_Ga=t,f=32,t=f,s=1,v=1,U=1,i=42;${Buffer.from(file).toString("base64")}\x1b\\`;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const setup = () => {
    const read = Promise.withResolvers<string>();
    const expand = vi.fn(async (parts: readonly KittyApcOutputPart[]) => {
      if (parts.some((part) => part.kind === "file")) return read.promise;
      return parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
    });
    const sent: Uint8Array[] = [];
    const session = { pid: 1, isPaused: false, pause: vi.fn(), resume: vi.fn() };
    session.pause.mockImplementation(() => {
      session.isPaused = true;
    });
    session.resume.mockImplementation(() => {
      session.isPaused = false;
    });
    const client = {
      pending: false,
      compressMode: null,
      framingEnabled: false,
      ws: {
        readyState: 1,
        raw: { bufferedAmount: 0 },
        send: (bytes: Uint8Array) => sent.push(bytes),
        close: vi.fn(),
      },
    } as unknown as ManagedClient;
    const managed = {
      id: "fixture",
      clients: new Set([client]),
      session,
      outputBatch: "",
      outputBatchTimer: null,
      outputBurstStartedAtMs: null,
      outputBurstIsStream: false,
      atomicOutputFrameOpen: false,
      automation: null,
      drainPollTimer: null,
      synchronizedOutputEndDetector: createSynchronizedOutputEndDetector(),
    } as unknown as ManagedSession;
    const coordinator = new SessionOutputCoordinator({
      outputTransport: new SessionOutputTransport(() => {}),
      noteOutputActivity: () => {},
      onOutputActivity: () => {},
      writeInput: () => {},
      expandFileOutput: expand,
    });
    return { read, expand, sent, session, client, managed, coordinator };
  };

  it("pauses at admission, stays paused during slow I/O, then drains in order", async () => {
    const { read, sent, session, managed, coordinator } = setup();
    const tasks = [coordinator.onSessionOutput(managed, sequence)];
    const chunk = "x".repeat(OUTPUT_BATCH_FLUSH_BYTES);
    let admittedBytes = 0;
    try {
      while (!session.isPaused && admittedBytes <= WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES) {
        tasks.push(coordinator.onSessionOutput(managed, chunk));
        admittedBytes += chunk.length;
      }
      expect(session.pause).toHaveBeenCalledOnce();
      expect(admittedBytes).toBeLessThanOrEqual(WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES);
      expect(sent).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(WS_OUTBOUND_DRAIN_POLL_MS);
      expect(session.resume).not.toHaveBeenCalled();
      read.resolve("image");
      await Promise.all(tasks);
      coordinator.finishOutputBurst(managed);
      await vi.advanceTimersByTimeAsync(WS_OUTBOUND_DRAIN_POLL_MS);
      expect(session.resume).toHaveBeenCalledOnce();
      expect(managed.drainPollTimer).toBeNull();
      const output = Buffer.concat(sent).toString();
      expect(output).toBe(`image${"x".repeat(admittedBytes)}`);
    } finally {
      read.resolve("");
      coordinator.disposeSession(managed);
    }
  });

  it("does not expand another image until downstream parser pressure drains", async () => {
    const { read, expand, session, managed, coordinator } = setup();
    const renderer = {
      queuedBytes: 0,
      write: vi.fn(() => {
        renderer.queuedBytes = RENDERER_PENDING_PAUSE_HIGH_WATER_BYTES;
      }),
    };
    managed.captureRenderer = renderer as unknown as CaptureRenderer;
    try {
      const first = coordinator.onSessionOutput(managed, sequence);
      const second = coordinator.onSessionOutput(managed, sequence);
      read.resolve("image");
      await first;
      expect(expand).toHaveBeenCalledOnce();
      expect(session.isPaused).toBe(true);
      await vi.advanceTimersByTimeAsync(WS_OUTBOUND_DRAIN_POLL_MS);
      expect(expand).toHaveBeenCalledOnce();
      renderer.queuedBytes = RENDERER_PENDING_RESUME_LOW_WATER_BYTES;
      await vi.advanceTimersByTimeAsync(WS_OUTBOUND_DRAIN_POLL_MS);
      await second;
      expect(expand).toHaveBeenCalledTimes(2);
      expect(session.isPaused).toBe(true);
      expect(session.pause).toHaveBeenCalledTimes(2);
    } finally {
      coordinator.disposeSession(managed);
    }
  });

  it("contains expansion rejection without poisoning subsequent output", async () => {
    const { read, sent, managed, coordinator } = setup();
    try {
      const first = coordinator.onSessionOutput(managed, sequence);
      const second = coordinator.onSessionOutput(managed, "after-error");
      read.reject(new Error("injected file error"));
      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
      coordinator.finishOutputBurst(managed);
      expect(Buffer.concat(sent).toString()).toBe("after-error");
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("injected file error"));
      await coordinator.onSessionOutput(managed, "new-output");
      coordinator.finishOutputBurst(managed);
      expect(Buffer.concat(sent).toString()).toBe("after-errornew-output");
    } finally {
      coordinator.disposeSession(managed);
    }
  });

  it("releases queued output and never resurrects a disposed session", async () => {
    const { read, sent, session, managed, coordinator } = setup();
    const first = coordinator.onSessionOutput(managed, sequence);
    const queued = coordinator.onSessionOutput(managed, "stale");
    coordinator.disposeSession(managed);
    await queued;
    read.resolve("stale-image");
    await first;
    await coordinator.onSessionOutput(managed, "late-output");
    await vi.advanceTimersByTimeAsync(WS_OUTBOUND_DRAIN_POLL_MS);
    expect(sent).toHaveLength(0);
    expect(managed.outputBatch).toBe("");
    expect(session.resume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
