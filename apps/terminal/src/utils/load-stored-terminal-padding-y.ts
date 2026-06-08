import { DEFAULT_TERMINAL_PADDING_Y_PX, TERMINAL_PADDING_Y_STORAGE_KEY } from "@/lib/constants";
import { clampTerminalPaddingY } from "@/utils/clamp-terminal-padding";

export const loadStoredTerminalPaddingY = (): number => {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_PADDING_Y_PX;
  try {
    const raw = window.localStorage.getItem(TERMINAL_PADDING_Y_STORAGE_KEY);
    if (raw === null || raw === "") return DEFAULT_TERMINAL_PADDING_Y_PX;
    return clampTerminalPaddingY(Number(raw));
  } catch {
    return DEFAULT_TERMINAL_PADDING_Y_PX;
  }
};
