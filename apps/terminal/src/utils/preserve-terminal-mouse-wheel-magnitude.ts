import type { IDisposable, Terminal as XtermTerminal } from "@xterm/xterm";

interface XtermCoreMouseEvent {
  col: number;
  row: number;
  x: number;
  y: number;
  button: number;
  action: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

interface XtermMouseService {
  _consumeWheelEvent?: (
    event: WheelEvent,
    cellHeight?: number,
    devicePixelRatio?: number,
  ) => number;
  _triggerMouseEvent?: (event: XtermCoreMouseEvent) => boolean;
}

interface XtermTerminalWithMouseService extends XtermTerminal {
  _core?: {
    _mouseService?: XtermMouseService;
  };
}

// xterm normalizes a physical wheel event to a row count, but its mouse-protocol
// path emits only one report regardless of that count. Carry the count into its
// existing protocol encoder, matching xterm's own magnitude-preserving touch path.
export const preserveTerminalMouseWheelMagnitude = (
  terminal: XtermTerminal,
): IDisposable | null => {
  const mouseService = (terminal as XtermTerminalWithMouseService)._core?._mouseService;
  const originalConsumeWheelEvent = mouseService?._consumeWheelEvent;
  const originalTriggerMouseEvent = mouseService?._triggerMouseEvent;
  if (!mouseService || !originalConsumeWheelEvent || !originalTriggerMouseEvent) return null;

  let pendingWheelReportCount = 1;
  const consumeWheelEvent = (
    event: WheelEvent,
    cellHeight?: number,
    devicePixelRatio?: number,
  ): number => {
    const lines = originalConsumeWheelEvent.call(mouseService, event, cellHeight, devicePixelRatio);
    pendingWheelReportCount =
      terminal.modes.mouseTrackingMode === "none" || lines === 0
        ? 1
        : Math.min(Math.max(1, terminal.rows), Math.max(1, Math.floor(Math.abs(lines))));
    return lines;
  };
  const triggerMouseEvent = (event: XtermCoreMouseEvent): boolean => {
    const wheelReportCount = pendingWheelReportCount;
    pendingWheelReportCount = 1;
    let didTriggerMouseEvent = false;
    for (let wheelReportIndex = 0; wheelReportIndex < wheelReportCount; wheelReportIndex += 1) {
      didTriggerMouseEvent =
        originalTriggerMouseEvent.call(mouseService, { ...event }) || didTriggerMouseEvent;
    }
    return didTriggerMouseEvent;
  };

  mouseService._consumeWheelEvent = consumeWheelEvent;
  mouseService._triggerMouseEvent = triggerMouseEvent;

  return {
    dispose: () => {
      if (mouseService._consumeWheelEvent === consumeWheelEvent) {
        mouseService._consumeWheelEvent = originalConsumeWheelEvent;
      }
      if (mouseService._triggerMouseEvent === triggerMouseEvent) {
        mouseService._triggerMouseEvent = originalTriggerMouseEvent;
      }
    },
  };
};
