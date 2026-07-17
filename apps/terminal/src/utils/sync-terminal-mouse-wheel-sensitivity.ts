import {
  XTERM_DEFAULT_SCROLL_SENSITIVITY,
  XTERM_TRACKPAD_WHEEL_DELTA_THRESHOLD_PX,
  XTERM_TRACKPAD_WHEEL_SCALE,
} from "@/lib/constants";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

export const syncTerminalMouseWheelSensitivity = (event: WheelEvent, terminal: XtermTerminal) => {
  const shouldCompensateForTrackpadScale =
    terminal.modes.mouseTrackingMode !== "none" &&
    event.deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
    Math.abs(event.deltaY) < XTERM_TRACKPAD_WHEEL_DELTA_THRESHOLD_PX;
  const scrollSensitivity = shouldCompensateForTrackpadScale
    ? XTERM_DEFAULT_SCROLL_SENSITIVITY / XTERM_TRACKPAD_WHEEL_SCALE
    : XTERM_DEFAULT_SCROLL_SENSITIVITY;
  if (terminal.options.scrollSensitivity !== scrollSensitivity) {
    terminal.options.scrollSensitivity = scrollSensitivity;
  }
};
