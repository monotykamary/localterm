import { NERD_FONT_ENABLED_STORAGE_KEY } from "@/lib/constants";

export const storeNerdFontEnabled = (enabled: boolean): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NERD_FONT_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    /* localStorage unavailable; selection still applies in-session */
  }
};
