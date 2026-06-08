import { TERMINAL_PADDING_X_STORAGE_KEY } from "@/lib/constants";

export const storeTerminalPaddingX = (paddingX: number): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TERMINAL_PADDING_X_STORAGE_KEY, String(paddingX));
  } catch {
    /* localStorage unavailable; padding still applies in-session */
  }
};
