import { useEffect, useState } from "react";
import { detectDeviceTier } from "@/utils/detect-device-tier";
import type { DeviceTier } from "@/utils/detect-device-tier";
import { DEVICE_TABLET_MIN_WIDTH_PX } from "@/lib/constants";

// Reactive: pointer/hover media change at runtime (iPad trackpad hot-plug,
// dock/undock), so re-detect on matchMedia change instead of memoizing once.
export const useDeviceTier = (): DeviceTier => {
  const [tier, setTier] = useState<DeviceTier>(() => detectDeviceTier());
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const queries = [
      window.matchMedia("(hover: hover), (pointer: fine)"),
      window.matchMedia("(pointer: coarse)"),
      window.matchMedia("(min-width: " + DEVICE_TABLET_MIN_WIDTH_PX + "px)"),
    ];
    const update = () => setTier(detectDeviceTier());
    for (const query of queries) query.addEventListener("change", update);
    return () => {
      for (const query of queries) query.removeEventListener("change", update);
    };
  }, []);
  return tier;
};
