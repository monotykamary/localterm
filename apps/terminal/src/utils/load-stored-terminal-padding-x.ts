import { DEFAULT_TERMINAL_PADDING_X_PX, TERMINAL_PADDING_X_STORAGE_KEY } from "@/lib/constants";
import { clampTerminalPaddingX } from "@/utils/clamp-terminal-padding";

export const loadStoredTerminalPaddingX = (): number => {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_PADDING_X_PX;
  try {
    const raw = window.localStorage.getItem(TERMINAL_PADDING_X_STORAGE_KEY);
    if (raw === null || raw === "") return DEFAULT_TERMINAL_PADDING_X_PX;
    return clampTerminalPaddingX(Number(raw));
  } catch {
    return DEFAULT_TERMINAL_PADDING_X_PX;
  }
};
