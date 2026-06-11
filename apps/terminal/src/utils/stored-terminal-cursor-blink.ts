import { DEFAULT_TERMINAL_CURSOR_BLINK, TERMINAL_CURSOR_BLINK_STORAGE_KEY } from "@/lib/constants";
import { createBooleanStoredSetting } from "@/utils/create-stored-setting";

const setting = createBooleanStoredSetting(
  TERMINAL_CURSOR_BLINK_STORAGE_KEY,
  DEFAULT_TERMINAL_CURSOR_BLINK,
);

export const loadStoredTerminalCursorBlink = setting.load;
export const storeTerminalCursorBlink = setting.store;
