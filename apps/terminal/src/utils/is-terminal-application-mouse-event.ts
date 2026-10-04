import type { Terminal as XtermTerminal } from "@xterm/xterm";

export const isTerminalApplicationMouseEvent = (
  terminal: Pick<XtermTerminal, "modes" | "options">,
  event: Pick<MouseEvent, "altKey" | "shiftKey">,
  platform = navigator.platform,
): boolean => {
  if (terminal.modes.mouseTrackingMode === "none") return false;
  if (terminal.options.mouseEventsRequireAlt) return event.altKey;

  // Match xterm's selection override, including its desktop-only Mac check.
  // A locally selected gesture is not sent to the TUI and can open a link here.
  const isMac = /^(Macintosh|MacIntel|MacPPC|Mac68K)$/.test(platform);
  return isMac
    ? !(event.altKey && terminal.options.macOptionClickForcesSelection)
    : !event.shiftKey;
};
