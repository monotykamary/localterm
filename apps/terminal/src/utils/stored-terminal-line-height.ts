import { DEFAULT_TERMINAL_LINE_HEIGHT, TERMINAL_LINE_HEIGHT_STORAGE_KEY } from "@/lib/constants";
import { clampTerminalLineHeight } from "@/utils/clamp-terminal-line-height";
import { createNumericStoredSetting } from "@/utils/create-stored-setting";

const setting = createNumericStoredSetting(
  TERMINAL_LINE_HEIGHT_STORAGE_KEY,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  clampTerminalLineHeight,
);

export const loadStoredTerminalLineHeight = setting.load;
export const storeTerminalLineHeight = setting.store;
export const subscribeStoredTerminalLineHeight = setting.subscribe;
