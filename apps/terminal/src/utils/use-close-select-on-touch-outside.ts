import { useEffect } from "react";
import { isCoarsePointer } from "./is-coarse-pointer";
import { useLatestRef } from "./use-latest-ref";

// On touch, tapping the terminal to dismiss an open select would otherwise let
// the terminal's `touchend` handler call focusTerminalForInput() and pop the
// virtual keyboard — the dismiss tap never intended to type. This hook blocks
// that path while leaving taps on other controls (sliders, buttons inside the
// settings menu) untouched.
//
// The select itself closes via Base UI's pointerdown outside-press (the
// SettingsSelect uses modal={false} so the terminal isn't inert), and this
// hook also calls onOpenChange(false) on touchstart for robustness. But that
// close would re-run this effect's cleanup and tear the touchend listener down
// before the gesture ends, so the listeners are attached ONCE for the
// component's lifetime and gated by refs (not the `open` prop) — otherwise the
// touchend listener would be removed mid-gesture and the keyboard would still
// pop.
//
// Scoped to the terminal surface ([data-terminal-surface]) so a tap on, say, a
// font-size slider while a theme select is open still reaches the slider.
export const useCloseSelectOnTouchOutside = (
  open: boolean,
  onOpenChange: (open: boolean) => void,
): void => {
  const openRef = useLatestRef(open);
  const onOpenChangeRef = useLatestRef(onOpenChange);
  useEffect(() => {
    if (!isCoarsePointer()) return;
    let dismissGesture = false;
    const isTerminalSurface = (target: EventTarget | null): boolean =>
      target instanceof Element && Boolean(target.closest("[data-terminal-surface]"));
    const handleTouchStart = (event: TouchEvent) => {
      if (!openRef.current) return;
      if (!isTerminalSurface(event.target)) return;
      dismissGesture = true;
      onOpenChangeRef.current(false);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (!dismissGesture) return;
      dismissGesture = false;
      // Stop propagation in the capture phase: window is an ancestor of the
      // terminal element, so this runs before the terminal's own touchend
      // listener (which calls focusTerminalForInput → keyboard).
      event.stopPropagation();
    };
    window.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    window.addEventListener("touchend", handleTouchEnd, { capture: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart, { capture: true });
      window.removeEventListener("touchend", handleTouchEnd, { capture: true });
    };
  }, [openRef, onOpenChangeRef]);
};
