import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { KittyApcScanner } from "../src/kitty-apc-scanner.js";
import { SessionOutputCoordinator } from "../src/session-output-coordinator.js";
import { SessionOutputTransport } from "../src/session-output-transport.js";
import type { ManagedClient, ManagedSession } from "../src/session-manager.js";
import { createSynchronizedOutputEndDetector } from "../src/utils/create-synchronized-output-end-detector.js";
import type { ServerToClientMessage } from "../src/types.js";
import { WS_READY_STATE_OPEN } from "../src/constants.js";

describe("KittyApcScanner screen resets", () => {
  const tmpdir = process.env.TMPDIR || os.tmpdir();
  const isAllowedPath = (name: string) => {
    try {
      return fs.realpathSync(name).startsWith(fs.realpathSync(tmpdir) + path.sep);
    } catch {
      return false;
    }
  };

  it("detects an alt-screen leave in one chunk", () => {
    const scanner = new KittyApcScanner(isAllowedPath);
    const scan = scanner.push("some bytes\x1b[?1049lmore");
    expect(scan.screenReset).toBe(true);
  });

  it("detects a leave split across chunks", () => {
    const scanner = new KittyApcScanner(isAllowedPath);
    expect(scanner.push("bytes\x1b[?10").screenReset).toBe(false);
    expect(scanner.push("49lrest").screenReset).toBe(true);
  });

  it("detects hard reset and older alt codes", () => {
    for (const sequence of ["\x1b[?1047l", "\x1b[?47l", "\x1bc"]) {
      const scanner = new KittyApcScanner(isAllowedPath);
      expect(scanner.push("a" + sequence + "b").screenReset).toBe(true);
    }
  });

  it("does not trip on alt-screen entry or unrelated sequences", () => {
    const scanner = new KittyApcScanner(isAllowedPath);
    expect(scanner.push("\x1b[?1049h\x1b[2J\x1b[H").screenReset).toBe(false);
  });
});

describe("SessionOutputCoordinator frame lifecycle", () => {
  const tmpdir = process.env.TMPDIR || os.tmpdir();

  const makeSession = () => {
    const controls: ServerToClientMessage[] = [];
    const client = {
      pending: false,
      framingEnabled: true,
      compressMode: null,
      ws: {
        readyState: WS_READY_STATE_OPEN,
        send: (raw: string | ArrayBuffer | Uint8Array) => {
          void raw;
        },
        close: () => undefined,
      },
      pendingQueue: [],
      pendingBytesLength: 0,
      pendingControlMessageCount: 0,
      pendingOverflowed: false,
    } as unknown as ManagedClient;
    const managed = {
      id: "reset-test",
      owner: null,
      clients: new Set([client]),
      session: { pid: 99, isPaused: false },
      synchronizedOutputEndDetector: createSynchronizedOutputEndDetector(),
      outputBatch: "",
      outputBatchTimer: null,
      outputBurstStartedAtMs: null,
      outputBurstIsStream: false,
      atomicOutputFrameOpen: false,
      automation: null,
      automationLog: "",
      captureRenderer: undefined,
      drainPollTimer: null,
      lastOutputAt: 0,
    } as unknown as ManagedSession;
    const transport = new SessionOutputTransport((_ws, control) => {
      controls.push(control);
    });
    const coordinator = new SessionOutputCoordinator({
      outputTransport: transport,
      noteOutputActivity: () => undefined,
      onOutputActivity: () => undefined,
      writeInput: () => undefined,
    });
    return { managed, coordinator, controls };
  };

  const emitFrame = (coordinator: SessionOutputCoordinator, managed: ManagedSession) => {
    const frameFile = path.join(tmpdir, "kitty-reset-frame.rgba");
    fs.writeFileSync(frameFile, Buffer.alloc(16, 4));
    const name = Buffer.from(frameFile).toString("base64");
    coordinator.onSessionOutput(managed, `\x1b_Ga=T,f=32,s=2,v=2,t=f,i=1,q=2;${name}\x1b\\`);
    fs.rmSync(frameFile, { force: true });
  };

  it("broadcasts pixel-frames-clear when a framing app leaves the alt screen", () => {
    const { managed, coordinator, controls } = makeSession();
    emitFrame(coordinator, managed);
    coordinator.onSessionOutput(managed, "\x1b[?1049l$ ");
    expect(controls.some((control) => control.type === "pixel-frames-clear")).toBe(true);
  });

  it("does not broadcast pixel-frames-clear without prior frames", () => {
    const { managed, coordinator, controls } = makeSession();
    coordinator.onSessionOutput(managed, "\x1b[?1049l$ ");
    expect(controls.some((control) => control.type === "pixel-frames-clear")).toBe(false);
  });
});
