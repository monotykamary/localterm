import { useSyncExternalStore } from "react";
import { detectDeviceTier } from "@/utils/detect-device-tier";
import type { DeviceTier } from "@/utils/detect-device-tier";
import { DEVICE_TABLET_MIN_WIDTH_PX } from "@/lib/constants";

const subscribeToDeviceTier = (onStoreChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => undefined;
  const finePointerQuery = window.matchMedia("(hover: hover), (pointer: fine)");
  const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
  const tabletWidthQuery = window.matchMedia("(min-width: " + DEVICE_TABLET_MIN_WIDTH_PX + "px)");
  finePointerQuery.addEventListener("change", onStoreChange);
  coarsePointerQuery.addEventListener("change", onStoreChange);
  tabletWidthQuery.addEventListener("change", onStoreChange);
  return () => {
    finePointerQuery.removeEventListener("change", onStoreChange);
    coarsePointerQuery.removeEventListener("change", onStoreChange);
    tabletWidthQuery.removeEventListener("change", onStoreChange);
  };
};

export const useDeviceTier = (): DeviceTier =>
  useSyncExternalStore(subscribeToDeviceTier, detectDeviceTier, detectDeviceTier);
