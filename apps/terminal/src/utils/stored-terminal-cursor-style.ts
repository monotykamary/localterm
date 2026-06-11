import { TERMINAL_CURSOR_STYLE_STORAGE_KEY } from "@/lib/constants";
import { DEFAULT_TERMINAL_CURSOR_STYLE, isTerminalCursorStyle } from "@/lib/terminal-cursor";
import { createStringValidatedStoredSetting } from "@/utils/create-stored-setting";

const setting = createStringValidatedStoredSetting(
  TERMINAL_CURSOR_STYLE_STORAGE_KEY,
  DEFAULT_TERMINAL_CURSOR_STYLE,
  isTerminalCursorStyle,
);

export const loadStoredTerminalCursorStyle = setting.load;
export const storeTerminalCursorStyle = setting.store;
