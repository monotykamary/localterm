import fs from "node:fs/promises";
import path from "node:path";
import { MAX_PIXEL_FRAME_BYTES } from "./constants.js";
import type { SessionOutputTransport } from "./session-output-transport.js";
import type { ManagedSession } from "./session-manager.js";
import type { KittyPixelFrame } from "./kitty-apc-scanner.js";

interface RelayState {
  pending: KittyPixelFrame | null;
  active: boolean;
}

export const readPixelFrame = async (
  frame: KittyPixelFrame,
  tmpdirRoot: string,
): Promise<Uint8Array | null> => {
  const expected = frame.width * frame.height * 4;
  if (expected <= 0 || expected > MAX_PIXEL_FRAME_BYTES) return null;
  try {
    const real = await fs.realpath(frame.path);
    if (!real.startsWith(tmpdirRoot + path.sep)) return null;
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size !== expected) return null;
    const pixels = await fs.readFile(real);
    return pixels.length === expected ? new Uint8Array(pixels) : null;
  } catch {
    return null;
  }
};

// latest-wins relay: the app renders at display cadence while a frame read +
// broadcast is async, so frames must not queue (that would pile up megabytes of
// RGBA). The newest frame replaces any previous one still pending, bounding
// memory and keeping the client as fresh as possible.
export class KittyFrameFileRelay {
  private readonly states = new WeakMap<ManagedSession, RelayState>();

  constructor(private readonly transport: SessionOutputTransport) {}

  push(managed: ManagedSession, frame: KittyPixelFrame, tmpdirRoot: string): void {
    let state = this.states.get(managed);
    if (!state) {
      state = { pending: null, active: false };
      this.states.set(managed, state);
    }
    state.pending = frame;
    if (!state.active) {
      state.active = true;
      void this.pump(managed, state, tmpdirRoot);
    }
  }

  private async pump(
    managed: ManagedSession,
    state: RelayState,
    tmpdirRoot: string,
  ): Promise<void> {
    try {
      while (state.pending) {
        const frame = state.pending;
        state.pending = null;
        const pixels = await readPixelFrame(frame, tmpdirRoot);
        if (pixels) {
          this.transport.broadcastPixelFrame(managed, frame.width, frame.height, pixels);
        }
      }
    } finally {
      state.active = false;
    }
  }
}
