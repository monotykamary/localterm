import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX,
  TERMINAL_VIEWPORT_WIDTH_STABLE_PX,
} from "@/lib/constants";
import { ON_SCREEN_KEYBOARD_CONTROL_SELECTOR } from "@/lib/on-screen-keyboard-selectors";
import type { DeviceTier } from "@/utils/detect-device-tier";
import { detectIsAppleWebKit } from "@/utils/detect-is-apple-webkit";
import { dismissSystemKeyboard } from "@/utils/dismiss-system-keyboard";
import { suppressTerminalSystemKeyboard } from "@/utils/suppress-terminal-system-keyboard";

interface UseTerminalOnScreenKeyboardOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  rootRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<XtermTerminal | null>;
  refocusTerminalRef: RefObject<(() => void) | null>;
  deviceTier: DeviceTier;
  isTouchDevice: boolean;
  setIsActionsMenuOpen: Dispatch<SetStateAction<boolean>>;
}

export const useTerminalOnScreenKeyboard = ({
  containerRef,
  rootRef,
  terminalRef,
  refocusTerminalRef,
  deviceTier,
  isTouchDevice,
  setIsActionsMenuOpen,
}: UseTerminalOnScreenKeyboardOptions) => {
  const [isOnScreenKeyboardOpen, setIsOnScreenKeyboardOpen] = useState(false);
  const [onScreenKeyboardHeight, setOnScreenKeyboardHeight] = useState(0);
  const onScreenKeyboardOpenRef = useRef(false);
  const isAppleWebKit = useMemo(detectIsAppleWebKit, []);
  const refocusTerminal = useCallback(() => refocusTerminalRef.current?.(), [refocusTerminalRef]);
  const closeOnScreenKeyboard = useCallback(() => {
    onScreenKeyboardOpenRef.current = false;
    setIsOnScreenKeyboardOpen(false);
  }, []);
  const dismissOnScreenKeyboard = useCallback(() => {
    closeOnScreenKeyboard();
    setIsActionsMenuOpen(false);
  }, [closeOnScreenKeyboard, setIsActionsMenuOpen]);
  const openOnScreenKeyboard = useCallback(() => {
    suppressTerminalSystemKeyboard(terminalRef.current?.textarea);
    dismissSystemKeyboard();
    onScreenKeyboardOpenRef.current = true;
    setIsOnScreenKeyboardOpen(true);
  }, [terminalRef]);
  const toggleOnScreenKeyboard = useCallback(() => {
    if (onScreenKeyboardOpenRef.current) dismissOnScreenKeyboard();
    else openOnScreenKeyboard();
  }, [dismissOnScreenKeyboard, openOnScreenKeyboard]);

  useEffect(() => {
    if (deviceTier === "desktop") dismissOnScreenKeyboard();
  }, [deviceTier, dismissOnScreenKeyboard]);

  // Focus the terminal cursor whenever the on-screen keyboard opens. The
  // guarded helper textarea keeps the system keyboard suppressed, and re-focus
  // after each keystroke keeps xterm's cursor block solid while using the OSK.
  useEffect(() => {
    if (!isOnScreenKeyboardOpen) return;
    refocusTerminalRef.current?.();
  }, [isOnScreenKeyboardOpen, refocusTerminalRef]);

  useEffect(() => {
    if (!isOnScreenKeyboardOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(ON_SCREEN_KEYBOARD_CONTROL_SELECTOR)) {
        return;
      }
      closeOnScreenKeyboard();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target === terminalRef.current?.textarea) return;
      if (
        event.target instanceof Element &&
        event.target.closest(ON_SCREEN_KEYBOARD_CONTROL_SELECTOR)
      ) {
        return;
      }
      closeOnScreenKeyboard();
    };
    // Some Android IMEs ignore both flags on an already-focused textarea. A large,
    // width-stable viewport shrink is the final signal to evict that stale IME.
    const visualViewport = window.visualViewport;
    let baselineViewportHeight = visualViewport?.height ?? 0;
    let baselineViewportWidth = visualViewport?.width ?? 0;
    const handleViewportResize = () => {
      if (!visualViewport) return;
      const viewportHeight = visualViewport.height;
      const viewportWidth = visualViewport.width;
      const didViewportWidthChange =
        Math.abs(viewportWidth - baselineViewportWidth) >= TERMINAL_VIEWPORT_WIDTH_STABLE_PX;
      if (didViewportWidthChange) {
        baselineViewportHeight = viewportHeight;
        baselineViewportWidth = viewportWidth;
        return;
      }
      const didSystemKeyboardOpen =
        viewportHeight < baselineViewportHeight - TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX;
      if (onScreenKeyboardOpenRef.current && didSystemKeyboardOpen) {
        baselineViewportHeight = viewportHeight;
        suppressTerminalSystemKeyboard(terminalRef.current?.textarea);
        dismissSystemKeyboard();
        refocusTerminalRef.current?.();
        return;
      }
      baselineViewportHeight = Math.max(baselineViewportHeight, viewportHeight);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    visualViewport?.addEventListener("resize", handleViewportResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [
    closeOnScreenKeyboard,
    containerRef,
    isOnScreenKeyboardOpen,
    refocusTerminalRef,
    terminalRef,
  ]);

  // Hardware back / iOS edge-swipe dismisses the on-screen keyboard instead of
  // navigating: push a history entry on open and pop it on close so a back
  // gesture closes the keyboard.
  useEffect(() => {
    if (!isOnScreenKeyboardOpen) return;
    window.history.pushState({ localtermOsk: true }, "");
    const onPopState = () => dismissOnScreenKeyboard();
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (window.history.state?.localtermOsk) window.history.back();
    };
  }, [dismissOnScreenKeyboard, isOnScreenKeyboardOpen]);

  // Apple WebKit ignores `interactive-widget=resizes-content` (set in
  // index.html) — its keyboard overlays the layout viewport, where Chromium
  // shrinks it above the keyboard in one browser-driven pass. Only WebKit
  // needs this hand-rolled shrink+translate, rAF-coalesced so the keyboard
  // animation's per-frame visualViewport events fold into one aligned style
  // write; the transform drops at zero offset to avoid a needless layer.
  useEffect(() => {
    if (!isTouchDevice || !isAppleWebKit) return;
    const root = rootRef.current;
    const visualViewport = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!root || !visualViewport) return;
    let pendingFrame: number | null = null;
    const apply = () => {
      pendingFrame = null;
      root.style.height = `${visualViewport.height}px`;
      const offsetTop = visualViewport.offsetTop;
      root.style.transform = offsetTop ? `translateY(${offsetTop}px)` : "";
    };
    const schedule = () => {
      if (pendingFrame !== null) return;
      pendingFrame = window.requestAnimationFrame(apply);
    };
    schedule();
    visualViewport.addEventListener("resize", schedule);
    visualViewport.addEventListener("scroll", schedule);
    return () => {
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
      visualViewport.removeEventListener("resize", schedule);
      visualViewport.removeEventListener("scroll", schedule);
      root.style.height = "";
      root.style.transform = "";
    };
  }, [isTouchDevice, isAppleWebKit, rootRef]);

  return {
    isOnScreenKeyboardOpen,
    onScreenKeyboardHeight,
    onScreenKeyboardOpenRef,
    setOnScreenKeyboardHeight,
    refocusTerminal,
    closeOnScreenKeyboard,
    dismissOnScreenKeyboard,
    openOnScreenKeyboard,
    toggleOnScreenKeyboard,
  };
};
