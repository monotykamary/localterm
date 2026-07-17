export const resolveHerdrThemeId = (themeName: string): string | null => {
  const normalizedThemeName = themeName.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  switch (normalizedThemeName) {
    case "catppuccin":
    case "catppuccin-mocha":
      return "catppuccin-mocha";
    case "catppuccin-latte":
    case "latte":
    case "light":
      return "catppuccin-latte";
    case "tokyo-night":
    case "tokyonight":
      return "tokyo-night";
    case "dracula":
      return "dracula";
    case "nord":
      return "nord";
    case "gruvbox":
    case "gruvbox-dark":
      return "gruvbox-dark";
    case "one-dark":
    case "onedark":
      return "one-dark-pro";
    case "solarized":
    case "solarized-dark":
      return "solarized-dark";
    case "solarized-light":
      return "solarized-light";
    case "vesper":
      return "vesper";
    default:
      return null;
  }
};
