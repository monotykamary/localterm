import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { describe, expect, it } from "vite-plus/test";
import { shouldSuppressAltBufferWheel } from "../../src/utils/should-suppress-alt-buffer-wheel";

interface FakeTerminalOptions {
  bufferType: "normal" | "alternate";
  mouseTrackingMode?: "none" | "x10" | "vt200" | "drag" | "any";
}

const createFakeTerminal = ({
  bufferType,
  mouseTrackingMode = "none",
}: FakeTerminalOptions): XtermTerminal =>
  ({
    buffer: { active: { type: bufferType } },
    modes: { mouseTrackingMode },
  }) as unknown as XtermTerminal;

const createWheelEvent = (deltaMode: number): WheelEvent => ({ deltaMode }) as WheelEvent;

describe("shouldSuppressAltBufferWheel", () => {
  it("suppresses pixel-delta wheels in the alt buffer without mouse tracking (trackpad inertia)", () => {
    const terminal = createFakeTerminal({ bufferType: "alternate" });
    const event = createWheelEvent(WheelEvent.DOM_DELTA_PIXEL);
    expect(shouldSuppressAltBufferWheel(event, terminal)).toBe(true);
  });

  it("lets line-delta wheels through in the alt buffer (clicky mouse)", () => {
    const terminal = createFakeTerminal({ bufferType: "alternate" });
    const event = createWheelEvent(WheelEvent.DOM_DELTA_LINE);
    expect(shouldSuppressAltBufferWheel(event, terminal)).toBe(false);
  });

  it("lets pixel-delta wheels through when mouse tracking is active", () => {
    for (const mode of ["x10", "vt200", "drag", "any"] as const) {
      const terminal = createFakeTerminal({ bufferType: "alternate", mouseTrackingMode: mode });
      const event = createWheelEvent(WheelEvent.DOM_DELTA_PIXEL);
      expect(shouldSuppressAltBufferWheel(event, terminal)).toBe(false);
    }
  });

  it("never suppresses in the normal buffer regardless of delta mode", () => {
    const terminal = createFakeTerminal({ bufferType: "normal" });
    expect(
      shouldSuppressAltBufferWheel(createWheelEvent(WheelEvent.DOM_DELTA_PIXEL), terminal),
    ).toBe(false);
    expect(
      shouldSuppressAltBufferWheel(createWheelEvent(WheelEvent.DOM_DELTA_LINE), terminal),
    ).toBe(false);
  });
});
