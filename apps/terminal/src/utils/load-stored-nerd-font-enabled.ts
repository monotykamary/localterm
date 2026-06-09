import { NERD_FONT_ENABLED_STORAGE_KEY } from "@/lib/constants";

export const loadStoredNerdFontEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NERD_FONT_ENABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};
