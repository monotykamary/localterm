import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { RefObject } from "react";
import {
  TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX,
  TERMINAL_TAP_MOVEMENT_THRESHOLD_PX,
  TERMINAL_VIEWPORT_WIDTH_STABLE_PX,
} from "@/lib/constants";
import { dispatchTerminalMouseTap } from "@/utils/dispatch-terminal-mouse-tap";
import { isTerminalCursorTap } from "@/utils/is-terminal-cursor-tap";
import { suppressTerminalSystemKeyboard } from "@/utils/suppress-terminal-system-keyboard";

interface InstallTerminalTouchInteractionsOptions {
  terminal: XtermTerminal;
  container: HTMLDivElement;
  isTouchDevice: boolean;
  onScreenKeyboardOpenRef: RefObject<boolean>;
  openOnScreenKeyboard: () => void;
}

interface TerminalTouchInteractions {
  refocusTerminalQuietly: () => void;
  dispose: () => void;
}

export const installTerminalTouchInteractions = ({
  terminal,
  container,
  isTouchDevice,
  onScreenKeyboardOpenRef,
  openOnScreenKeyboard,
}: InstallTerminalTouchInteractionsOptions): TerminalTouchInteractions => {
  const helperTextArea = container.querySelector("textarea.xterm-helper-textarea");
  if (helperTextArea instanceof HTMLTextAreaElement) {
    helperTextArea.autocomplete = "off";
    helperTextArea.setAttribute("autocapitalize", "off");
    helperTextArea.setAttribute("autocorrect", "off");
    helperTextArea.spellcheck = false;
    if (isTouchDevice) suppressTerminalSystemKeyboard(helperTextArea);
  }

  let tapStartClientX = 0;
  let tapStartClientY = 0;
  let tapMovedBeyondThreshold = false;
  // Programmatic refocus after an overlay closes (settings/keep-awake menu,
  // search, command palette, diff viewer): route keystrokes back to the
  // terminal. inputMode "none" keeps the system keyboard suppressed on touch
  // while still focusing the textarea so xterm's cursor block stays solid.
  const refocusTerminalQuietly = () => {
    if (isTouchDevice) suppressTerminalSystemKeyboard(terminal.textarea);
    if (terminal.textarea !== document.activeElement) terminal.focus();
  };
  const handleTerminalTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      tapMovedBeyondThreshold = true;
      return;
    }
    tapStartClientX = event.touches[0].clientX;
    tapStartClientY = event.touches[0].clientY;
    tapMovedBeyondThreshold = false;
  };
  const handleTerminalTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      tapMovedBeyondThreshold = true;
      return;
    }
    const movedPx = Math.hypot(
      event.touches[0].clientX - tapStartClientX,
      event.touches[0].clientY - tapStartClientY,
    );
    if (movedPx > TERMINAL_TAP_MOVEMENT_THRESHOLD_PX) {
      tapMovedBeyondThreshold = true;
    }
  };
  const handleTerminalTouchEnd = (event: TouchEvent) => {
    if (tapMovedBeyondThreshold) {
      event.preventDefault();
      return;
    }
    const endingTouch = event.changedTouches[0];
    const tapClientX = endingTouch?.clientX ?? tapStartClientX;
    const tapClientY = endingTouch?.clientY ?? tapStartClientY;
    if (terminal.modes.mouseTrackingMode !== "none") {
      const screen = container.querySelector(".xterm-screen");
      if (!(screen instanceof HTMLElement)) return;
      const screenRect = screen.getBoundingClientRect();
      const didTapTerminalCursor = isTerminalCursorTap({
        isCursorVisible: terminal.modes.showCursor,
        tapClientX,
        tapClientY,
        screenLeft: screenRect.left,
        screenTop: screenRect.top,
        screenWidth: screenRect.width,
        screenHeight: screenRect.height,
        columns: terminal.cols,
        rows: terminal.rows,
        cursorColumn: terminal.buffer.active.cursorX,
        cursorRow: terminal.buffer.active.cursorY,
      });
      event.preventDefault();
      if (didTapTerminalCursor && !onScreenKeyboardOpenRef.current) {
        openOnScreenKeyboard();
        return;
      }
      dispatchTerminalMouseTap(screen, { clientX: tapClientX, clientY: tapClientY });
      return;
    }
    if (onScreenKeyboardOpenRef.current) return;
    event.preventDefault();
    openOnScreenKeyboard();
  };
  const tapListenerAbort = new AbortController();
  if (isTouchDevice) {
    // inputMode="none" is the primary IME guard; readOnly backs it up for
    // Android keyboards that ignore inputMode when xterm re-focuses an
    // already-active helper textarea. Keeping both on every focus path makes
    // the terminal custom-keyboard-only without affecting the app's inputs.
    const guardTextarea = () => {
      suppressTerminalSystemKeyboard(terminal.textarea);
    };
    const blurAndGuardTextarea = () => {
      suppressTerminalSystemKeyboard(terminal.textarea);
      terminal.textarea?.blur();
    };
    guardTextarea();
    terminal.textarea?.addEventListener("blur", guardTextarea, {
      signal: tapListenerAbort.signal,
    });
    // A native keyboard that was already active can dismiss without blurring
    // xterm's helper (Android back, an IME hide-toggle, iOS swipe-down). A
    // growing visualViewport is the cross-platform hide signal; reset the
    // helper there so a later xterm scroll-refocus starts from the guarded,
    // unfocused state instead of reviving the stale IME session.
    const visualViewport = window.visualViewport;
    if (visualViewport) {
      let prevViewportHeight = visualViewport.height;
      let prevViewportWidth = visualViewport.width;
      const onViewportResize = () => {
        const height = visualViewport.height;
        const width = visualViewport.width;
        const grew = height > prevViewportHeight + TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX;
        const widthStable =
          Math.abs(width - prevViewportWidth) < TERMINAL_VIEWPORT_WIDTH_STABLE_PX;
        if (grew && widthStable) blurAndGuardTextarea();
        prevViewportHeight = height;
        prevViewportWidth = width;
      };
      visualViewport.addEventListener("resize", onViewportResize, {
        signal: tapListenerAbort.signal,
      });
    }
    terminal.element?.addEventListener("touchstart", handleTerminalTouchStart, {
      capture: true,
      passive: true,
      signal: tapListenerAbort.signal,
    });
    terminal.element?.addEventListener("touchmove", handleTerminalTouchMove, {
      capture: true,
      passive: true,
      signal: tapListenerAbort.signal,
    });
    terminal.element?.addEventListener("touchend", handleTerminalTouchEnd, {
      capture: true,
      passive: false,
      signal: tapListenerAbort.signal,
    });
  }

  return {
    refocusTerminalQuietly,
    dispose: () => tapListenerAbort.abort(),
  };
};
