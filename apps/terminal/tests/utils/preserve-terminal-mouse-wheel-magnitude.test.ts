import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vite-plus/test";
import { preserveTerminalMouseWheelMagnitude } from "../../src/utils/preserve-terminal-mouse-wheel-magnitude";

interface FakeCoreMouseEvent {
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

interface FakeMouseService {
  _consumeWheelEvent: (event: WheelEvent, cellHeight?: number, devicePixelRatio?: number) => number;
  _triggerMouseEvent: (event: FakeCoreMouseEvent) => boolean;
}

interface FakeTerminalOptions {
  lines: number;
  mouseTrackingMode?: "none" | "any";
  rows?: number;
}

const createCoreMouseEvent = (): FakeCoreMouseEvent => ({
  col: 4,
  row: 5,
  x: 40,
  y: 50,
  button: 4,
  action: 0,
  ctrl: false,
  alt: false,
  shift: false,
});

const createFakeTerminal = ({
  lines,
  mouseTrackingMode = "any",
  rows = 40,
}: FakeTerminalOptions) => {
  const triggeredEvents: FakeCoreMouseEvent[] = [];
  const mouseService: FakeMouseService = {
    _consumeWheelEvent: vi.fn(() => lines),
    _triggerMouseEvent: vi.fn((event: FakeCoreMouseEvent) => {
      triggeredEvents.push({ ...event });
      event.col += 1;
      return true;
    }),
  };
  const terminal = {
    rows,
    modes: { mouseTrackingMode },
    _core: { _mouseService: mouseService },
  } as unknown as XtermTerminal;
  return { mouseService, terminal, triggeredEvents };
};

describe("preserveTerminalMouseWheelMagnitude", () => {
  it("emits one independent mouse report for every normalized wheel row", () => {
    const { mouseService, terminal, triggeredEvents } = createFakeTerminal({ lines: -12 });
    preserveTerminalMouseWheelMagnitude(terminal);

    mouseService._consumeWheelEvent(new WheelEvent("wheel"), 20, 1);
    const didTrigger = mouseService._triggerMouseEvent(createCoreMouseEvent());

    expect(didTrigger).toBe(true);
    expect(triggeredEvents).toHaveLength(12);
    expect(triggeredEvents.every((event) => event.col === 4)).toBe(true);
  });

  it("caps one physical event to one terminal viewport", () => {
    const { mouseService, terminal, triggeredEvents } = createFakeTerminal({
      lines: 100,
      rows: 24,
    });
    preserveTerminalMouseWheelMagnitude(terminal);

    mouseService._consumeWheelEvent(new WheelEvent("wheel"), 20, 1);
    mouseService._triggerMouseEvent(createCoreMouseEvent());

    expect(triggeredEvents).toHaveLength(24);
  });

  it("retains one report outside terminal mouse tracking", () => {
    const { mouseService, terminal, triggeredEvents } = createFakeTerminal({
      lines: 12,
      mouseTrackingMode: "none",
    });
    preserveTerminalMouseWheelMagnitude(terminal);

    mouseService._consumeWheelEvent(new WheelEvent("wheel"), 20, 1);
    mouseService._triggerMouseEvent(createCoreMouseEvent());

    expect(triggeredEvents).toHaveLength(1);
  });

  it("restores xterm's original methods when disposed", () => {
    const { mouseService, terminal } = createFakeTerminal({ lines: 3 });
    const originalConsumeWheelEvent = mouseService._consumeWheelEvent;
    const originalTriggerMouseEvent = mouseService._triggerMouseEvent;
    const disposable = preserveTerminalMouseWheelMagnitude(terminal);

    disposable?.dispose();

    expect(mouseService._consumeWheelEvent).toBe(originalConsumeWheelEvent);
    expect(mouseService._triggerMouseEvent).toBe(originalTriggerMouseEvent);
  });
});
