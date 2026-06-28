import { useEffect } from "react";
import { isCoarsePointer } from "./is-coarse-pointer";

// Base UI's Select outside-press uses "sloppy" mode, which for a clean touch
// tap relies on the synthetic `mousedown` the browser fires after `touchend`.
// xterm calls `preventDefault()` on `touchstart` (its gesture dispatch), which
// suppresses that synthetic `mousedown` — so tapping the terminal (the main
// "outside" target) never closes an open select. `pointerdown` fires before
// `touchstart` and isn't suppressed, so a capture-phase `pointerdown` listener
// closes the select reliably. This mirrors the actions-menu outside-tap pattern
// (terminal.tsx's `handleOutsidePress`). Only touch/pen are handled so the
// desktop mouse path keeps Base UI's own dismissal untouched. The content is
// portaled to <body> and carries `data-slot="select-content"`; the trigger
// carries `data-slot="select-trigger"` — taps inside either are left to Base UI.
export const useCloseSelectOnTouchOutside = (
  open: boolean,
  onOpenChange: (open: boolean) => void,
): void => {
  useEffect(() => {
    if (!open || !isCoarsePointer()) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const target = event.target as Element | null;
      if (
        target instanceof Element &&
        target.closest('[data-slot="select-content"], [data-slot="select-trigger"]')
      ) {
        return;
      }
      onOpenChange(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, onOpenChange]);
};
