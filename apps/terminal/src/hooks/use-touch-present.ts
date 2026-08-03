import { useSyncExternalStore } from "react";
import { detectTouchPresent } from "@/utils/detect-touch-present";

const subscribeToTouchPresent = (onStoreChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => undefined;
  const anyCoarsePointerQuery = window.matchMedia("(any-pointer: coarse)");
  anyCoarsePointerQuery.addEventListener("change", onStoreChange);
  return () => anyCoarsePointerQuery.removeEventListener("change", onStoreChange);
};

export const useTouchPresent = (): boolean =>
  useSyncExternalStore(subscribeToTouchPresent, detectTouchPresent, detectTouchPresent);
