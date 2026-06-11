import { DEFAULT_TERMINAL_PADDING_X_PX, TERMINAL_PADDING_X_STORAGE_KEY } from "@/lib/constants";
import { clampTerminalPaddingX } from "@/utils/clamp-terminal-padding";
import { createNumericStoredSetting } from "@/utils/create-stored-setting";

const setting = createNumericStoredSetting(
  TERMINAL_PADDING_X_STORAGE_KEY,
  DEFAULT_TERMINAL_PADDING_X_PX,
  clampTerminalPaddingX,
);

export const loadStoredTerminalPaddingX = setting.load;
export const storeTerminalPaddingX = setting.store;
