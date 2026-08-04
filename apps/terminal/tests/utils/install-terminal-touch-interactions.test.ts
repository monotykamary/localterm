import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
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
    buffer: { active: { cursorX: 0, cursorY: 0 } },
    cols: 80,
    element: container,
    focus: vi.fn(),
    modes: { mouseTrackingMode, showCursor: true },
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
    });

    dispatchTouch(container);

    expect(openOnScreenKeyboard).not.toHaveBeenCalled();
    expect(mouseDown).toHaveBeenCalledOnce();
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
    });

    dispatchTouch(container);

    expect(openOnScreenKeyboard).toHaveBeenCalledOnce();
    interactions.dispose();
  });
});
