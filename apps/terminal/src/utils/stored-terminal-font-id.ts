import { TERMINAL_FONT_STORAGE_KEY } from "@/lib/constants";
import { findTerminalFontById } from "@/lib/terminal-fonts";
import { createStringLookupStoredSetting } from "@/utils/create-stored-setting";

const setting = createStringLookupStoredSetting(
  TERMINAL_FONT_STORAGE_KEY,
  (raw) => findTerminalFontById(raw).id,
  (id) => id,
);

export const loadStoredTerminalFontId = setting.load;
export const storeTerminalFontId = setting.store;
export const subscribeStoredTerminalFontId = setting.subscribe;
