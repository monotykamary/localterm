interface HerdrThemeConfig {
  themeName: string;
  autoSwitch: boolean;
}

const TOML_TABLE_PATTERN = /^\s*\[\s*([A-Za-z0-9_.-]+)\s*]\s*(?:#.*)?$/;
const THEME_NAME_PATTERN = /^\s*name\s*=\s*(["'])([A-Za-z0-9 _-]+)\1\s*(?:#.*)?$/;
const AUTO_SWITCH_PATTERN = /^\s*auto_switch\s*=\s*(true|false)\s*(?:#.*)?$/;

export const parseHerdrThemeConfig = (content: string): HerdrThemeConfig | null => {
  let isThemeSection = false;
  let themeName: string | null = null;
  let autoSwitch = false;

  for (const line of content.split(/\r?\n/)) {
    const tableMatch = TOML_TABLE_PATTERN.exec(line);
    if (tableMatch) {
      isThemeSection = tableMatch[1].trim() === "theme";
      continue;
    }
    if (!isThemeSection) continue;

    const themeNameMatch = THEME_NAME_PATTERN.exec(line);
    if (themeNameMatch) {
      themeName = themeNameMatch[2];
      continue;
    }

    const autoSwitchMatch = AUTO_SWITCH_PATTERN.exec(line);
    if (autoSwitchMatch) autoSwitch = autoSwitchMatch[1] === "true";
  }

  return themeName === null ? null : { themeName, autoSwitch };
};
