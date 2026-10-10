import type { IBufferCellPosition, IBufferRange, Terminal as XtermTerminal } from "@xterm/xterm";
import { isTerminalApplicationMouseEvent } from "@/utils/is-terminal-application-mouse-event";

interface MouseReportService {
  _sendEvent: (context: unknown, event: MouseEvent) => boolean;
}

interface LinkMouseCore {
  _mouseService?: MouseReportService;
  _mouseCoordsService?: {
    getCoords: (
      event: MouseEvent,
      element: HTMLElement,
      cols: number,
      rows: number,
    ) => [number, number] | undefined;
  };
  screenElement?: HTMLElement;
  linkifier?: { currentLink?: { link: { range: IBufferRange } } };
}

interface PendingLinkPress {
  context: unknown;
  event: MouseEvent;
  cell: IBufferCellPosition;
}

interface TerminalLinkMouseGuard {
  shouldOpenLink: (event: MouseEvent) => boolean;
  dispose: () => void;
}

// xterm activates links on the screen's mouseup, then reports the same gesture
// to the PTY. Defer only link presses at its report boundary: a local activation
// consumes both ends, while a drag or non-activation replays the original press.
// Keeping xterm's DOM listeners running preserves focus and mouseup cleanup.
export const installTerminalLinkMouseGuard = (
  terminal: XtermTerminal,
): TerminalLinkMouseGuard | null => {
  const core = (terminal as unknown as { _core?: LinkMouseCore })._core;
  const mouseService = core?._mouseService;
  const mouseCoords = core?._mouseCoordsService;
  const screen = core?.screenElement;
  const element = terminal.element;
  if (!mouseService?._sendEvent || !mouseCoords || !screen || !element || !core?.linkifier)
    return null;
  const originalSendEvent = mouseService._sendEvent;
  const ownerDocument = element.ownerDocument;
  const consumedReleases = new WeakSet<MouseEvent>();
  let pending: PendingLinkPress | undefined;
  let applicationHasPress = false;
  let cancelled = false;
  let discardedButton: number | undefined;

  const cellAt = (event: MouseEvent): IBufferCellPosition | undefined => {
    const coords = mouseCoords.getCoords(event, screen, terminal.cols, terminal.rows);
    return coords ? { x: coords[0], y: coords[1] + terminal.buffer.active.viewportY } : undefined;
  };
  const isLinkCell = (cell: IBufferCellPosition): boolean => {
    const range = core.linkifier?.currentLink?.link.range;
    if (!range) return false;
    const index = cell.y * terminal.cols + cell.x;
    return (
      index >= range.start.y * terminal.cols + range.start.x &&
      index <= range.end.y * terminal.cols + range.end.x
    );
  };
  const flushPress = () => {
    const press = pending;
    if (!press) return;
    pending = undefined;
    applicationHasPress = true;
    originalSendEvent.call(mouseService, press.context, press.event);
  };
  const beginGesture = (event: MouseEvent) => {
    cancelled = false;
    discardedButton = undefined;
    if (pending && event.buttons !== 1 && event.buttons !== 4) {
      flushPress();
      return;
    }
    pending = undefined;
    applicationHasPress = false;
  };
  const moveGesture = (event: MouseEvent) => {
    if (!pending) return;
    if (!event.buttons) {
      cancelGesture();
      return;
    }
    const cell = cellAt(event);
    if (!cell || cell.x !== pending.cell.x || cell.y !== pending.cell.y) flushPress();
  };
  const finishGesture = (event: MouseEvent) => {
    if (pending && event.button !== pending.event.button) return;
    flushPress();
    applicationHasPress = false;
  };
  const cancelGesture = () => {
    discardedButton = pending?.event.button ?? discardedButton;
    pending = undefined;
    cancelled = true;
  };
  const sendEvent = (context: unknown, event: MouseEvent): boolean => {
    if (consumedReleases.has(event)) return false;
    if (event.type === "mouseup" && event.button === discardedButton) {
      discardedButton = undefined;
      return false;
    }
    if (event.type === "mousedown") {
      const cell = cellAt(event);
      if (
        !applicationHasPress &&
        (event.button === 0 || event.button === 1) &&
        cell &&
        isLinkCell(cell)
      ) {
        pending = { context, event, cell };
        return false;
      }
      applicationHasPress = true;
    } else if (event.type === "mousemove" && pending) {
      return false;
    } else if (event.type === "wheel") {
      flushPress();
    }
    return originalSendEvent.call(mouseService, context, event);
  };

  mouseService._sendEvent = sendEvent;
  element.addEventListener("mousedown", beginGesture, true);
  ownerDocument.addEventListener("mousemove", moveGesture, true);
  // Registered before xterm's per-press document listener, but after the screen
  // link activation in bubbling order. Also finishes X10's press-only gestures.
  ownerDocument.addEventListener("mouseup", finishGesture);
  ownerDocument.defaultView?.addEventListener("blur", cancelGesture);

  return {
    shouldOpenLink: (event) => {
      if (cancelled || applicationHasPress) return false;
      if (!pending) return !isTerminalApplicationMouseEvent(terminal, event);
      consumedReleases.add(event);
      pending = undefined;
      return true;
    },
    dispose: () => {
      cancelGesture();
      element.removeEventListener("mousedown", beginGesture, true);
      ownerDocument.removeEventListener("mousemove", moveGesture, true);
      ownerDocument.removeEventListener("mouseup", finishGesture);
      ownerDocument.defaultView?.removeEventListener("blur", cancelGesture);
      if (mouseService._sendEvent === sendEvent) mouseService._sendEvent = originalSendEvent;
    },
  };
};
