import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { XTERM_TOUCH_SCROLL_EVENT } from "../../src/lib/constants";
import { installTerminalTouchInteractions } from "../../src/utils/install-terminal-touch-interactions";

interface TouchInteractionHarness {
  readonly container: HTMLDivElement;
  readonly screen: HTMLDivElement;
  readonly terminal: XtermTerminal;
}

const createHarness = (mouseTrackingMode: "none" | "any"): TouchInteractionHarness => {
  const container = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  const textarea = document.createElement("textarea");
  textarea.className = "xterm-helper-textarea";
  container.append(screen, textarea);
  document.body.append(container);
  const terminal = {
    cols: 80,
    element: container,
    focus: vi.fn(),
    modes: { mouseTrackingMode, showCursor: true },
    buffer: { active: { cursorX: 0, cursorY: 0, type: "normal" } },
    rows: 24,
    textarea,
  } as unknown as XtermTerminal;
  return { container, screen, terminal };
};

const dispatchTouch = (container: HTMLElement) => {
  const touchStart = new Event("touchstart", { bubbles: true, cancelable: true });
  Object.defineProperty(touchStart, "touches", {
    value: [{ clientX: 20, clientY: 30 }],
  });
  container.dispatchEvent(touchStart);
  const touchEnd = new Event("touchend", { bubbles: true, cancelable: true });
  Object.defineProperty(touchEnd, "changedTouches", {
    value: [{ clientX: 20, clientY: 30 }],
  });
  container.dispatchEvent(touchEnd);
};

describe("installTerminalTouchInteractions", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opens the keyboard on the first tap while mouse tracking is active", () => {
    const { container, screen, terminal } = createHarness("any");
    const openOnScreenKeyboard = vi.fn();
    const mouseDown = vi.fn();
    screen.addEventListener("mousedown", mouseDown);
    const interactions = installTerminalTouchInteractions({
      terminal,
      container,
      isTouchDevice: true,
      onScreenKeyboardOpenRef: { current: false },
      openOnScreenKeyboard,
      onUserScroll: vi.fn(),
    });

    dispatchTouch(container);

    expect(openOnScreenKeyboard).toHaveBeenCalledOnce();
    expect(mouseDown).not.toHaveBeenCalled();
    interactions.dispose();
  });

  it("delivers taps to the tracked application once the keyboard is open", () => {
    const { container, screen, terminal } = createHarness("any");
    const openOnScreenKeyboard = vi.fn();
    const mouseDown = vi.fn();
    screen.addEventListener("mousedown", mouseDown);
    const interactions = installTerminalTouchInteractions({
      terminal,
      container,
      isTouchDevice: true,
      onScreenKeyboardOpenRef: { current: true },
      openOnScreenKeyboard,
      onUserScroll: vi.fn(),
    });

    dispatchTouch(container);

    expect(openOnScreenKeyboard).not.toHaveBeenCalled();
    expect(mouseDown).toHaveBeenCalledOnce();
    interactions.dispose();
  });

  it("marks touch movement and inertia as user scrolling", () => {
    const { container, screen, terminal } = createHarness("none");
    const onUserScroll = vi.fn();
    const interactions = installTerminalTouchInteractions({
      terminal,
      container,
      isTouchDevice: true,
      onScreenKeyboardOpenRef: { current: false },
      openOnScreenKeyboard: vi.fn(),
      onUserScroll,
    });
    screen.dispatchEvent(new Event(XTERM_TOUCH_SCROLL_EVENT));
    screen.dispatchEvent(new Event(XTERM_TOUCH_SCROLL_EVENT));

    expect(onUserScroll).toHaveBeenCalledTimes(2);
    interactions.dispose();
    screen.dispatchEvent(new Event(XTERM_TOUCH_SCROLL_EVENT));
    expect(onUserScroll).toHaveBeenCalledTimes(2);
  });

  it("does not mark gestures owned by a mouse-tracking application", () => {
    const { container, screen, terminal } = createHarness("any");
    const onUserScroll = vi.fn();
    const interactions = installTerminalTouchInteractions({
      terminal,
      container,
      isTouchDevice: true,
      onScreenKeyboardOpenRef: { current: true },
      openOnScreenKeyboard: vi.fn(),
      onUserScroll,
    });

    screen.dispatchEvent(new Event(XTERM_TOUCH_SCROLL_EVENT));

    expect(onUserScroll).not.toHaveBeenCalled();
    interactions.dispose();
  });

  it("continues to open the keyboard when mouse tracking is inactive", () => {
    const { container, terminal } = createHarness("none");
    const openOnScreenKeyboard = vi.fn();
    const interactions = installTerminalTouchInteractions({
      terminal,
      container,
      isTouchDevice: true,
      onScreenKeyboardOpenRef: { current: false },
      openOnScreenKeyboard,
      onUserScroll: vi.fn(),
    });

    dispatchTouch(container);

    expect(openOnScreenKeyboard).toHaveBeenCalledOnce();
    interactions.dispose();
  });
});
