import fs from "node:fs/promises";
import { MAX_TERMINAL_BROWSER_FRAME_BYTES } from "./constants.js";
import type { SessionOutputTransport } from "./session-output-transport.js";
import type { ManagedSession } from "./session-manager.js";
import type { TerminalBrowserFrame } from "./terminal-browser-frame-scanner.js";

interface RelayState {
  pending: TerminalBrowserFrame | null;
  active: boolean;
}

async function readFrameFile(frame: TerminalBrowserFrame): Promise<Uint8Array<ArrayBuffer> | null> {
  const expected = frame.width * frame.height * 4;
  if (expected <= 0 || expected > MAX_TERMINAL_BROWSER_FRAME_BYTES) return null;
  try {
    const stat = await fs.stat(frame.path);
    if (stat.size !== expected) return null;
    const data = await fs.readFile(frame.path);
    if (data.length !== expected) return null;
    return new Uint8Array(data);
  } catch {
    return null;
  }
}

// latest-wins relay: terminal-browser renders at display cadence while a single
// frame read + broadcast is async, so frames must not queue (that would pile up
// megabytes of RGBA). The newest frame on the wire replaces any previous one
// still pending, bounding memory and keeping the client as fresh as possible.
export class TerminalBrowserFrameRelay {
  private readonly state = new WeakMap<ManagedSession, RelayState>();

  constructor(private readonly transport: SessionOutputTransport) {}

  push(managed: ManagedSession, frame: TerminalBrowserFrame): void {
    let state = this.state.get(managed);
    if (!state) {
      state = { pending: null, active: false };
      this.state.set(managed, state);
    }
    state.pending = frame;
    if (!state.active) {
      state.active = true;
      void this.pump(managed, state);
    }
  }

  private async pump(managed: ManagedSession, state: RelayState): Promise<void> {
    try {
      while (state.pending) {
        const frame = state.pending;
        state.pending = null;
        const pixels = await readFrameFile(frame);
        if (pixels) {
          this.transport.broadcastTerminalBrowserFrame(managed, frame.width, frame.height, pixels);
        }
      }
    } finally {
      state.active = false;
    }
  }
}
