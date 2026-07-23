import { TERMINAL_DARK_THEME_STORAGE_KEY } from "@/lib/constants";
import { DEFAULT_DARK_TERMINAL_THEME_ID, findTerminalThemeById } from "@/lib/terminal-themes";
import { createStringLookupStoredSetting } from "@/utils/create-stored-setting";
import { loadStoredCustomThemes } from "@/utils/stored-custom-themes";

const setting = createStringLookupStoredSetting(
  TERMINAL_DARK_THEME_STORAGE_KEY,
  (raw) => {
    if (!raw) return DEFAULT_DARK_TERMINAL_THEME_ID;
    const theme = findTerminalThemeById(raw, loadStoredCustomThemes());
    return theme.id === raw ? raw : DEFAULT_DARK_TERMINAL_THEME_ID;
  },
  (id) => id,
);

export const loadStoredTerminalDarkThemeId = setting.load;
export const storeTerminalDarkThemeId = setting.store;
export const subscribeStoredTerminalDarkThemeId = setting.subscribe;
