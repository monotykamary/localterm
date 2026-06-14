import { DEFAULT_TERMINAL_FONT_SIZE_PX, TERMINAL_FONT_SIZE_STORAGE_KEY } from "@/lib/constants";
import { clampTerminalFontSize } from "@/utils/clamp-terminal-font-size";
import { createNumericStoredSetting } from "@/utils/create-stored-setting";

const setting = createNumericStoredSetting(
  TERMINAL_FONT_SIZE_STORAGE_KEY,
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  clampTerminalFontSize,
);

export const loadStoredTerminalFontSize = setting.load;
export const storeTerminalFontSize = setting.store;
export const subscribeStoredTerminalFontSize = setting.subscribe;
