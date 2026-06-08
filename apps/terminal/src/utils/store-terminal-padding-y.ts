import { TERMINAL_PADDING_Y_STORAGE_KEY } from "@/lib/constants";

export const storeTerminalPaddingY = (paddingY: number): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TERMINAL_PADDING_Y_STORAGE_KEY, String(paddingY));
  } catch {
    /* localStorage unavailable; padding still applies in-session */
  }
};
