import { TERMINAL_FONT_STORAGE_KEY } from "@/lib/constants";
import { DEFAULT_TERMINAL_FONT_ID, findTerminalFontById } from "@/lib/terminal-fonts";

export const loadStoredTerminalFontId = (): string => {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_FONT_ID;
  try {
    const stored = window.localStorage.getItem(TERMINAL_FONT_STORAGE_KEY);
    return findTerminalFontById(stored).id;
  } catch {
    return DEFAULT_TERMINAL_FONT_ID;
  }
};
