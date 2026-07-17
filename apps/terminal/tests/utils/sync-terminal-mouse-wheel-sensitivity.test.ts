import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { describe, expect, it } from "vite-plus/test";
import {
  XTERM_DEFAULT_SCROLL_SENSITIVITY,
  XTERM_TRACKPAD_WHEEL_SCALE,
} from "../../src/lib/constants";
import { syncTerminalMouseWheelSensitivity } from "../../src/utils/sync-terminal-mouse-wheel-sensitivity";

const createFakeTerminal = (mouseTrackingMode: "none" | "any"): XtermTerminal =>
  ({
    modes: { mouseTrackingMode },
    options: { scrollSensitivity: XTERM_DEFAULT_SCROLL_SENSITIVITY },
  }) as unknown as XtermTerminal;

const createWheelEvent = (deltaY: number, deltaMode: number): WheelEvent =>
  new WheelEvent("wheel", { deltaY, deltaMode });

describe("syncTerminalMouseWheelSensitivity", () => {
  it("cancels xterm's likely-trackpad attenuation during mouse reporting", () => {
    const terminal = createFakeTerminal("any");

    syncTerminalMouseWheelSensitivity(createWheelEvent(10, WheelEvent.DOM_DELTA_PIXEL), terminal);

    expect(terminal.options.scrollSensitivity).toBe(
      XTERM_DEFAULT_SCROLL_SENSITIVITY / XTERM_TRACKPAD_WHEEL_SCALE,
    );
  });

  it("restores normal sensitivity for larger pixel deltas", () => {
    const terminal = createFakeTerminal("any");
    terminal.options.scrollSensitivity =
      XTERM_DEFAULT_SCROLL_SENSITIVITY / XTERM_TRACKPAD_WHEEL_SCALE;

    syncTerminalMouseWheelSensitivity(createWheelEvent(50, WheelEvent.DOM_DELTA_PIXEL), terminal);

    expect(terminal.options.scrollSensitivity).toBe(XTERM_DEFAULT_SCROLL_SENSITIVITY);
  });

  it("leaves line-delta and non-mouse-reporting wheels at normal sensitivity", () => {
    const mouseReportingTerminal = createFakeTerminal("any");
    const normalTerminal = createFakeTerminal("none");
    normalTerminal.options.scrollSensitivity =
      XTERM_DEFAULT_SCROLL_SENSITIVITY / XTERM_TRACKPAD_WHEEL_SCALE;

    syncTerminalMouseWheelSensitivity(
      createWheelEvent(3, WheelEvent.DOM_DELTA_LINE),
      mouseReportingTerminal,
    );
    syncTerminalMouseWheelSensitivity(
      createWheelEvent(10, WheelEvent.DOM_DELTA_PIXEL),
      normalTerminal,
    );

    expect(mouseReportingTerminal.options.scrollSensitivity).toBe(XTERM_DEFAULT_SCROLL_SENSITIVITY);
    expect(normalTerminal.options.scrollSensitivity).toBe(XTERM_DEFAULT_SCROLL_SENSITIVITY);
  });
});
