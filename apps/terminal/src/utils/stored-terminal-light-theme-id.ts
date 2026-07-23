import { TERMINAL_LIGHT_THEME_STORAGE_KEY } from "@/lib/constants";
import { DEFAULT_LIGHT_TERMINAL_THEME_ID, findTerminalThemeById } from "@/lib/terminal-themes";
import { createStringLookupStoredSetting } from "@/utils/create-stored-setting";
import { loadStoredCustomThemes } from "@/utils/stored-custom-themes";

const setting = createStringLookupStoredSetting(
  TERMINAL_LIGHT_THEME_STORAGE_KEY,
  (raw) => {
    if (!raw) return DEFAULT_LIGHT_TERMINAL_THEME_ID;
    const theme = findTerminalThemeById(raw, loadStoredCustomThemes());
    return theme.id === raw ? raw : DEFAULT_LIGHT_TERMINAL_THEME_ID;
  },
  (id) => id,
);

export const loadStoredTerminalLightThemeId = setting.load;
export const storeTerminalLightThemeId = setting.store;
export const subscribeStoredTerminalLightThemeId = setting.subscribe;
