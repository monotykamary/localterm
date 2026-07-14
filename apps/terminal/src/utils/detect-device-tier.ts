import { DEVICE_TABLET_MIN_WIDTH_PX } from "@/lib/constants";

export type DeviceTier = "desktop" | "tablet" | "mobile";

// A hardware-keyboard-class device can hover or has a fine primary pointer:
// desktops, laptops, touch-laptops, and an iPad with a trackpad all report one
// of these, so they never render the on-screen keyboard. Phones and tablets
// without a trackpad report (pointer: coarse) + (hover: none) and do. matchMedia
// reflects real input capability, unlike navigator.userAgent (iPadOS 13+
// ships a Mac UA, so UA sniffing can't tell an iPad from a Mac).
export const detectDeviceTier = (): DeviceTier => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "desktop";
  }
  if (window.matchMedia("(hover: hover), (pointer: fine)").matches) return "desktop";
  if (!window.matchMedia("(pointer: coarse)").matches) return "desktop";
  return window.matchMedia("(min-width: " + DEVICE_TABLET_MIN_WIDTH_PX + "px)").matches
    ? "tablet"
    : "mobile";
};
