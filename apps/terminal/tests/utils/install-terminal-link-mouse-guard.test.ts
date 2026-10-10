import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vite-plus/test";
import { installTerminalLinkMouseGuard } from "../../src/utils/install-terminal-link-mouse-guard";

const createHarness = () => {
  const element = document.createElement("div");
  const screen = document.createElement("div");
  element.appendChild(screen);
  document.body.appendChild(element);
  const originalSendEvent = vi.fn(() => true);
  const mouseService = {
    _sendEvent: originalSendEvent as (context: unknown, event: MouseEvent) => boolean,
  };
  const terminal = {
    element,
    cols: 80,
    rows: 24,
    buffer: { active: { viewportY: 10 } },
    modes: { mouseTrackingMode: "drag" },
    options: {},
    _core: {
      _mouseService: mouseService,
      _mouseCoordsService: { getCoords: (event: MouseEvent) => [event.clientX, event.clientY] },
      screenElement: screen,
      linkifier: {
        currentLink: { link: { range: { start: { x: 1, y: 11 }, end: { x: 8, y: 11 } } } },
      },
    },
  } as unknown as Terminal;
  const guard = installTerminalLinkMouseGuard(terminal);
  if (!guard) throw new Error("Mouse guard not installed");
  const context = {};
  const down = new MouseEvent("mousedown", { clientX: 2, clientY: 1, buttons: 1 });
  return {
    guard,
    originalSendEvent,
    mouseService,
    context,
    down,
    dispose: () => {
      guard.dispose();
      element.remove();
    },
  };
};

describe("installTerminalLinkMouseGuard", () => {
  it("leaves incompatible xterm internals untouched", () => {
    expect(installTerminalLinkMouseGuard({} as Terminal)).toBeNull();
  });

  it("uses buffer-relative link ranges and consumes only the matching activation", () => {
    const { guard, originalSendEvent, mouseService, context, down, dispose } = createHarness();
    try {
      expect(mouseService._sendEvent(context, down)).toBe(false);
      const up = new MouseEvent("mouseup", { clientX: 2, clientY: 1 });
      expect(guard.shouldOpenLink(up)).toBe(true);
      expect(guard.shouldOpenLink(up)).toBe(false);
      expect(mouseService._sendEvent(context, up)).toBe(false);
      expect(originalSendEvent).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("passes through presses outside the active link without deferring them", () => {
    const { guard, originalSendEvent, mouseService, context, dispose } = createHarness();
    try {
      const down = new MouseEvent("mousedown", { clientX: 20, clientY: 1, buttons: 1 });
      expect(mouseService._sendEvent(context, down)).toBe(true);
      expect(originalSendEvent).toHaveBeenCalledExactlyOnceWith(context, down);
      expect(guard.shouldOpenLink(new MouseEvent("mouseup"))).toBe(false);
    } finally {
      dispose();
    }
  });

  it("flushes the original press before wheel input without rebinding the service", () => {
    const { guard, originalSendEvent, mouseService, context, down, dispose } = createHarness();
    try {
      mouseService._sendEvent(context, down);
      const wheel = new WheelEvent("wheel", { clientX: 2, clientY: 1, deltaY: 1 });
      mouseService._sendEvent(context, wheel);
      expect(originalSendEvent.mock.calls).toEqual([
        [context, down],
        [context, wheel],
      ]);
      expect(originalSendEvent.mock.contexts).toEqual([mouseService, mouseService]);
      expect(guard.shouldOpenLink(new MouseEvent("mouseup"))).toBe(false);
    } finally {
      dispose();
    }
  });

  it("restores the report method and removes deferred-release listeners on dispose", () => {
    const { guard, originalSendEvent, mouseService, context, down, dispose } = createHarness();
    try {
      mouseService._sendEvent(context, down);
      guard.dispose();
      expect(mouseService._sendEvent).toBe(originalSendEvent);
      document.dispatchEvent(new MouseEvent("mouseup", { clientX: 2, clientY: 1 }));
      expect(originalSendEvent).not.toHaveBeenCalled();
      expect(guard.shouldOpenLink(new MouseEvent("mouseup"))).toBe(false);
    } finally {
      dispose();
    }
  });

  it("does not overwrite a later replacement when disposing", () => {
    const { guard, mouseService, dispose } = createHarness();
    try {
      const replacement = vi.fn(() => false);
      mouseService._sendEvent = replacement;
      guard.dispose();
      expect(mouseService._sendEvent).toBe(replacement);
    } finally {
      dispose();
    }
  });
});
