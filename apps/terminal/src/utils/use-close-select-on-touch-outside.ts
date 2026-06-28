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
// outside it. Both `touchstart` and `touchend` are handled:
//   - `touchstart` (capture, before xterm's own touchstart): `preventDefault`
//     cancels the synthetic mouse events the tap would otherwise fire (so the
//     terminal's click handler can't refocus and pop the keyboard), and
//     `stopPropagation` keeps xterm and localterm's own touch handlers from
//     seeing the tap.
//   - `touchend` (capture): `stopPropagation` keeps the terminal's
//     `focusTerminalForInput()` touchend handler from firing — that's the path
//     that opens the keyboard on a dismiss tap. Stopping `touchstart` alone
//     doesn't stop `touchend` (they're separate events), so without this the
//     dropdown would close but the keyboard would still pop.
// A single-finger dismiss is assumed: a flag marks the gesture started outside
// the select, and the `touchend` handler clears it.
export const useCloseSelectOnTouchOutside = (
  open: boolean,
  onOpenChange: (open: boolean) => void,
): void => {
  useEffect(() => {
    if (!open || !isCoarsePointer()) return;
    let dismissGesture = false;
    const isOutsideSelect = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      return !target.closest('[data-slot="select-content"], [data-slot="select-trigger"]');
    };
    const handleTouchStart = (event: TouchEvent) => {
      if (!isOutsideSelect(event.target)) return;
      dismissGesture = true;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (!dismissGesture) return;
      dismissGesture = false;
      event.stopPropagation();
    };
    window.addEventListener("touchstart", handleTouchStart, { capture: true, passive: false });
    window.addEventListener("touchend", handleTouchEnd, { capture: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart, { capture: true });
      window.removeEventListener("touchend", handleTouchEnd, { capture: true });
    };
  }, [open, onOpenChange]);
};
