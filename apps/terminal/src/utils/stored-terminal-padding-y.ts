import { DEFAULT_TERMINAL_PADDING_Y_PX, TERMINAL_PADDING_Y_STORAGE_KEY } from "@/lib/constants";
import { clampTerminalPaddingY } from "@/utils/clamp-terminal-padding";
import { createNumericStoredSetting } from "@/utils/create-stored-setting";

const setting = createNumericStoredSetting(
  TERMINAL_PADDING_Y_STORAGE_KEY,
  DEFAULT_TERMINAL_PADDING_Y_PX,
  clampTerminalPaddingY,
);

export const loadStoredTerminalPaddingY = setting.load;
export const storeTerminalPaddingY = setting.store;
