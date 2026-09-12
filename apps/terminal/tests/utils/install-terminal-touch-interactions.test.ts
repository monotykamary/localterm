import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { TERMINAL_LONG_PRESS_MS, XTERM_TOUCH_SCROLL_EVENT } from "../../src/lib/constants";
import { installTerminalTouchInteractions } from "../../src/utils/install-terminal-touch-interactions";

interface TouchInteractionHarness {
  readonly container: HTMLDivElement;
  readonly screen: HTMLDivElement;
  readonly textarea: HTMLTextAreaElement;
  readonly terminal: XtermTerminal;
  readonly paste: ReturnType<typeof vi.fn>;
  readonly select: ReturnType<typeof vi.fn>;
  readonly getSelection: ReturnType<typeof vi.fn>;
}

const createHarness = (mouseTrackingMode: "none" | "any"): TouchInteractionHarness => {
  const container = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  const textarea = document.createElement("textarea");
  textarea.className = "xterm-helper-textarea";
  container.append(screen, textarea);
  document.body.append(container);
  const paste = vi.fn();
  const select = vi.fn();
  const getSelection = vi.fn(() => "");
  const terminal = {
    cols: 80,
    element: container,
    focus: vi.fn(),
    getSelection,
    modes: { mouseTrackingMode, showCursor: true },
    paste,
    buffer: { active: { cursorX: 0, cursorY: 0, type: "normal", viewportY: 0 } },
    rows: 24,
    select,
    textarea,
  } as unknown as XtermTerminal;
  return { container, screen, textarea, terminal, paste, select, getSelection };
};

const dispatchTouchEvent = (
  container: HTMLElement,
  type: "touchstart" | "touchmove" | "touchend",
  clientX: number,
  clientY: number,
): void => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  if (type === "touchend") {
    Object.defineProperty(event, "changedTouches", { value: [{ clientX, clientY }] });
  } else {
    Object.defineProperty(event, "touches", { value: [{ clientX, clientY }] });
  }
  container.dispatchEvent(event);
};

const dispatchTouch = (container: HTMLElement) => {
  dispatchTouchEvent(container, "touchstart", 20, 30);
  dispatchTouchEvent(container, "touchend", 20, 30);
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

  describe("long-press clipboard", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("pastes clipboard text on a still long-press instead of opening the keyboard", async () => {
      vi.useFakeTimers();
      let pasted!: () => void;
      const pastedText = new Promise<void>((resolve) => {
        pasted = resolve;
      });
      const { container, terminal, paste } = createHarness("none");
      paste.mockImplementation(() => pasted());
      vi.stubGlobal("navigator", {
        clipboard: { readText: vi.fn().mockResolvedValue("echo hello") },
      });
      const openOnScreenKeyboard = vi.fn();
      const interactions = installTerminalTouchInteractions({
        terminal,
        container,
        isTouchDevice: true,
        onScreenKeyboardOpenRef: { current: false },
        openOnScreenKeyboard,
        onUserScroll: vi.fn(),
      });

      dispatchTouchEvent(container, "touchstart", 20, 30);
      await vi.advanceTimersByTimeAsync(TERMINAL_LONG_PRESS_MS);
      dispatchTouchEvent(container, "touchend", 20, 30);
      await pastedText;

      expect(openOnScreenKeyboard).not.toHaveBeenCalled();
      expect(paste).toHaveBeenCalledWith("echo hello");
      interactions.dispose();
    });

    it("does not paste when a native context menu already handled the hold", async () => {
      vi.useFakeTimers();
      const { container, terminal, paste } = createHarness("none");
      const readText = vi.fn().mockResolvedValue("echo hello");
      vi.stubGlobal("navigator", { clipboard: { readText } });
      const interactions = installTerminalTouchInteractions({
        terminal,
        container,
        isTouchDevice: true,
        onScreenKeyboardOpenRef: { current: false },
        openOnScreenKeyboard: vi.fn(),
        onUserScroll: vi.fn(),
      });

      dispatchTouchEvent(container, "touchstart", 20, 30);
      await vi.advanceTimersByTimeAsync(TERMINAL_LONG_PRESS_MS);
      container.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      dispatchTouchEvent(container, "touchend", 20, 30);
      await Promise.resolve();

      expect(readText).not.toHaveBeenCalled();
      expect(paste).not.toHaveBeenCalled();
      expect(terminal.textarea?.readOnly).toBe(false);
      expect(terminal.textarea?.inputMode).toBe("none");
      interactions.dispose();
    });

    it("selects and copies text when the finger moves after a long-press", async () => {
      vi.useFakeTimers();
      let copied!: () => void;
      const copiedText = new Promise<void>((resolve) => {
        copied = resolve;
      });
      const { container, screen, terminal, select, getSelection } = createHarness("none");
      getSelection.mockReturnValue("selected");
      const writeText = vi.fn().mockImplementation(() => {
        copied();
        return Promise.resolve();
      });
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      vi.spyOn(screen, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 80,
        height: 24,
        right: 80,
        bottom: 24,
        toJSON: () => ({}),
      });
      const openOnScreenKeyboard = vi.fn();
      const interactions = installTerminalTouchInteractions({
        terminal,
        container,
        isTouchDevice: true,
        onScreenKeyboardOpenRef: { current: false },
        openOnScreenKeyboard,
        onUserScroll: vi.fn(),
      });

      dispatchTouchEvent(container, "touchstart", 0, 0);
      await vi.advanceTimersByTimeAsync(TERMINAL_LONG_PRESS_MS);
      dispatchTouchEvent(container, "touchmove", 20, 0);
      dispatchTouchEvent(container, "touchend", 20, 0);
      await copiedText;

      expect(openOnScreenKeyboard).not.toHaveBeenCalled();
      expect(select).toHaveBeenCalledWith(0, 0, 20);
      expect(writeText).toHaveBeenCalledWith("selected");
      interactions.dispose();
    });

    it("still treats movement before the long-press delay as a scroll", async () => {
      vi.useFakeTimers();
      const { container, terminal, paste, select } = createHarness("none");
      const readText = vi.fn().mockResolvedValue("echo hello");
      vi.stubGlobal("navigator", { clipboard: { readText } });
      const openOnScreenKeyboard = vi.fn();
      const interactions = installTerminalTouchInteractions({
        terminal,
        container,
        isTouchDevice: true,
        onScreenKeyboardOpenRef: { current: false },
        openOnScreenKeyboard,
        onUserScroll: vi.fn(),
      });

      dispatchTouchEvent(container, "touchstart", 20, 30);
      dispatchTouchEvent(container, "touchmove", 20, 50);
      await vi.advanceTimersByTimeAsync(TERMINAL_LONG_PRESS_MS);
      dispatchTouchEvent(container, "touchend", 20, 50);
      await Promise.resolve();

      expect(openOnScreenKeyboard).not.toHaveBeenCalled();
      expect(paste).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(readText).not.toHaveBeenCalled();
      interactions.dispose();
    });
  });
});
