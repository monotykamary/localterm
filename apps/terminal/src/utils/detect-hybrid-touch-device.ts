import { detectDeviceTier } from "@/utils/detect-device-tier";
import { detectTouchPresent } from "@/utils/detect-touch-present";

// A touchscreen that isn't the primary input (touch laptops, convertibles,
// iPad + trackpad): touch gestures exist but every touch-primary affordance
// (auto-opening on-screen keyboard, coarse toolbar) stays desktop-class.
export const detectHybridTouchDevice = (): boolean =>
  detectTouchPresent() && detectDeviceTier() === "desktop";
