import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { RefObject } from "react";
import {
  HAPTIC_TAP_MS,
  TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX,
  TERMINAL_LONG_PRESS_MS,
  TERMINAL_TAP_MOVEMENT_THRESHOLD_PX,
  TERMINAL_VIEWPORT_WIDTH_STABLE_PX,
  XTERM_TOUCH_SCROLL_EVENT,
} from "@/lib/constants";
import { dispatchTerminalMouseTap } from "@/utils/dispatch-terminal-mouse-tap";
import { triggerHapticFeedback } from "@/utils/haptic-feedback";
import { suppressTerminalSystemKeyboard } from "@/utils/suppress-terminal-system-keyboard";
import {
  getTerminalCellFromPoint,
  selectTerminalRange,
  type TerminalCellPoint,
} from "@/utils/terminal-touch-selection";
import { copyTerminalSelection, pasteTerminalClipboard } from "@/utils/transfer-terminal-clipboard";

interface InstallTerminalTouchInteractionsOptions {
  terminal: XtermTerminal;
  container: HTMLDivElement;
  isTouchDevice: boolean;
  onScreenKeyboardOpenRef: RefObject<boolean>;
  openOnScreenKeyboard: () => void;
  onUserScroll: () => void;
}

interface TerminalTouchInteractions {
  refocusTerminalQuietly: () => void;
  dispose: () => void;
}

const allowHelperClipboard = (textarea: HTMLTextAreaElement | undefined): void => {
  if (!textarea) return;
  textarea.readOnly = false;
  textarea.inputMode = "none";
};

export const installTerminalTouchInteractions = ({
  terminal,
  container,
  isTouchDevice,
  onScreenKeyboardOpenRef,
  openOnScreenKeyboard,
  onUserScroll,
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
  let longPressArmed = false;
  let selectingAfterLongPress = false;
  let sawNativeContextMenu = false;
  let selectionStart: TerminalCellPoint | null = null;
  let longPressTimer: number | null = null;
  let isDisposed = false;
  // Programmatic refocus after an overlay closes (settings/keep-awake menu,
  // search, command palette, diff viewer): route keystrokes back to the
  // terminal. inputMode "none" keeps the system keyboard suppressed on touch
  // while still focusing the textarea so xterm's cursor block stays solid.
  const refocusTerminalQuietly = () => {
    if (isTouchDevice) suppressTerminalSystemKeyboard(terminal.textarea);
    if (terminal.textarea !== document.activeElement) terminal.focus();
  };
  const clearLongPressTimer = () => {
    if (longPressTimer === null) return;
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  };
  const resetGesture = () => {
    clearLongPressTimer();
    longPressArmed = false;
    selectingAfterLongPress = false;
    sawNativeContextMenu = false;
    selectionStart = null;
  };
  const screenElement = (): HTMLElement | null => {
    const screen = container.querySelector(".xterm-screen");
    return screen instanceof HTMLElement ? screen : null;
  };
  const cellAt = (clientX: number, clientY: number): TerminalCellPoint | null => {
    const screen = screenElement();
    if (!screen) return null;
    return getTerminalCellFromPoint(screen, terminal, clientX, clientY);
  };
  const handleTerminalTouchStart = (event: TouchEvent) => {
    resetGesture();
    if (event.touches.length !== 1) {
      tapMovedBeyondThreshold = true;
      return;
    }
    tapStartClientX = event.touches[0].clientX;
    tapStartClientY = event.touches[0].clientY;
    tapMovedBeyondThreshold = false;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      if (tapMovedBeyondThreshold || isDisposed) return;
      longPressArmed = true;
      triggerHapticFeedback(HAPTIC_TAP_MS);
    }, TERMINAL_LONG_PRESS_MS);
  };
  const handleTerminalTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      tapMovedBeyondThreshold = true;
      longPressArmed = false;
      selectingAfterLongPress = false;
      clearLongPressTimer();
      return;
    }
    const touch = event.touches[0];
    const movedPx = Math.hypot(touch.clientX - tapStartClientX, touch.clientY - tapStartClientY);
    if (movedPx > TERMINAL_TAP_MOVEMENT_THRESHOLD_PX) {
      tapMovedBeyondThreshold = true;
      if (!longPressArmed) {
        clearLongPressTimer();
        return;
      }
      event.preventDefault();
      if (!selectingAfterLongPress) {
        selectingAfterLongPress = true;
        selectionStart = cellAt(tapStartClientX, tapStartClientY);
      }
      const start = selectionStart;
      const end = cellAt(touch.clientX, touch.clientY);
      if (start && end) selectTerminalRange(terminal, start, end);
      return;
    }
    if (longPressArmed) event.preventDefault();
  };
  const finishLongPress = (event: TouchEvent): boolean => {
    if (!longPressArmed) return false;
    if (selectingAfterLongPress) {
      event.preventDefault();
      void copyTerminalSelection(() => terminal.getSelection());
      return true;
    }
    if (sawNativeContextMenu) return true;
    event.preventDefault();
    void pasteTerminalClipboard((text) => {
      if (!isDisposed) terminal.paste(text);
    });
    return true;
  };
  const handleTerminalTouchEnd = (event: TouchEvent) => {
    clearLongPressTimer();
    if (finishLongPress(event)) return;
    if (tapMovedBeyondThreshold) {
      event.preventDefault();
      return;
    }
    const endingTouch = event.changedTouches[0];
    const tapClientX = endingTouch?.clientX ?? tapStartClientX;
    const tapClientY = endingTouch?.clientY ?? tapStartClientY;
    if (terminal.modes.mouseTrackingMode !== "none") {
      event.preventDefault();
      if (!onScreenKeyboardOpenRef.current) {
        openOnScreenKeyboard();
        return;
      }
      const screen = screenElement();
      if (!screen) return;
      dispatchTerminalMouseTap(screen, { clientX: tapClientX, clientY: tapClientY });
      return;
    }
    if (onScreenKeyboardOpenRef.current) return;
    event.preventDefault();
    openOnScreenKeyboard();
  };
  const handleTerminalTouchCancel = () => {
    resetGesture();
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
    // Native long-press can still surface the OS copy/paste menu. Unlock the
    // helper textarea just for that gesture so Paste works, without enabling
    // the system IME (inputMode stays none).
    terminal.element?.addEventListener(
      "contextmenu",
      () => {
        sawNativeContextMenu = true;
        allowHelperClipboard(terminal.textarea);
      },
      { capture: true, signal: tapListenerAbort.signal },
    );
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
        const widthStable = Math.abs(width - prevViewportWidth) < TERMINAL_VIEWPORT_WIDTH_STABLE_PX;
        if (grew && widthStable) blurAndGuardTextarea();
        prevViewportHeight = height;
        prevViewportWidth = width;
      };
      visualViewport.addEventListener("resize", onViewportResize, {
        signal: tapListenerAbort.signal,
      });
    }
    container.querySelector(".xterm-screen")?.addEventListener(
      XTERM_TOUCH_SCROLL_EVENT,
      () => {
        if (
          terminal.buffer.active.type === "normal" &&
          terminal.modes.mouseTrackingMode === "none"
        ) {
          onUserScroll();
        }
      },
      { signal: tapListenerAbort.signal },
    );
    terminal.element?.addEventListener("touchstart", handleTerminalTouchStart, {
      capture: true,
      passive: true,
      signal: tapListenerAbort.signal,
    });
    // Non-passive so a long-press-then-drag can preventDefault and take over
    // from xterm's scroll gesture without fighting the on-screen keyboard tap.
    terminal.element?.addEventListener("touchmove", handleTerminalTouchMove, {
      capture: true,
      passive: false,
      signal: tapListenerAbort.signal,
    });
    terminal.element?.addEventListener("touchend", handleTerminalTouchEnd, {
      capture: true,
      passive: false,
      signal: tapListenerAbort.signal,
    });
    terminal.element?.addEventListener("touchcancel", handleTerminalTouchCancel, {
      capture: true,
      passive: true,
      signal: tapListenerAbort.signal,
    });
  }

  return {
    refocusTerminalQuietly,
    dispose: () => {
      isDisposed = true;
      resetGesture();
      tapListenerAbort.abort();
    },
  };
};
