import { TERMINAL_THEME_STORAGE_KEY } from "@/lib/constants";
import { AUTO_THEME_ID, findTerminalThemeById } from "@/lib/terminal-themes";
import { createStringLookupStoredSetting } from "@/utils/create-stored-setting";
import { loadStoredCustomThemes } from "@/utils/stored-custom-themes";

const setting = createStringLookupStoredSetting(
  TERMINAL_THEME_STORAGE_KEY,
  (raw) =>
    raw === AUTO_THEME_ID ? AUTO_THEME_ID : findTerminalThemeById(raw, loadStoredCustomThemes()).id,
  (id) => id,
);

export const loadStoredTerminalThemeId = setting.load;
export const storeTerminalThemeId = setting.store;
export const subscribeStoredTerminalThemeId = setting.subscribe;
