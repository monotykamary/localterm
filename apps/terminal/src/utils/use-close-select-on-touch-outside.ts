import { useEffect } from "react";
import { isCoarsePointer } from "./is-coarse-pointer";

// Base UI's Select defaults to `modal: true`, which marks the rest of the page
// `inert` so outside taps dispatch no pointer events — and xterm calls
// `preventDefault()` on `touchstart`, suppressing the synthetic `mousedown`
// the Select's own "sloppy" outside-press relies on. Together, tapping the
// terminal (the main outside target) never closes an open select on mobile.
//
// `modal={false}` on the Select removes the inert blocking so outside taps
// dispatch normally; this hook then closes the select on a touch that lands
// outside it. `touchstart` (not `pointerdown`) is the signal because it fires
// before xterm's `preventDefault` and is the earliest reliable touch event.
// `stopPropagation()` in the capture phase (window is the outermost, so this
// runs first) keeps the tap from reaching xterm's touch handler — which would
// otherwise call `focusTerminalForInput()` and pop the keyboard — so a
// dismiss-tap is a pure "close the dropdown" gesture. Taps inside the select
// content/trigger are left untouched for Base UI to handle.
export const useCloseSelectOnTouchOutside = (
  open: boolean,
  onOpenChange: (open: boolean) => void,
): void => {
  useEffect(() => {
    if (!open || !isCoarsePointer()) return;
    const handleTouchStart = (event: TouchEvent) => {
      const target = event.target as Element | null;
      if (
        target instanceof Element &&
        target.closest('[data-slot="select-content"], [data-slot="select-trigger"]')
      ) {
        return;
      }
      event.stopPropagation();
      onOpenChange(false);
    };
    window.addEventListener("touchstart", handleTouchStart, { capture: true });
    return () => window.removeEventListener("touchstart", handleTouchStart, { capture: true });
  }, [open, onOpenChange]);
};
