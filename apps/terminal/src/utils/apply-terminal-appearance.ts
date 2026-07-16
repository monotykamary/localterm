import type { TerminalTheme } from "@/lib/terminal-themes";
import {
  FALLBACK_TERMINAL_BACKGROUND_HEX,
  FALLBACK_TERMINAL_FOREGROUND_HEX,
} from "@/lib/constants";
import { isLightTerminalTheme } from "@/utils/is-light-terminal-theme";

const TERMINAL_APPEARANCE_ATTRIBUTE = "data-terminal-appearance";
const TERMINAL_APPEARANCE_STYLE_PROPERTIES = [
  "--localterm-background",
  "--localterm-foreground",
  "--localterm-accent",
  "--localterm-accent-foreground",
  "--localterm-muted-foreground",
  "--localterm-red",
  "--localterm-green",
  "--localterm-yellow",
  "--localterm-blue",
  "--localterm-magenta",
  "--localterm-cyan",
  "--localterm-font-family",
];

export const applyTerminalAppearance = (theme: TerminalTheme, fontFamily: string): (() => void) => {
  const documentElement = document.documentElement;
  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const previousThemeColor = themeColorMeta?.content;
  const previousBodyBackground = document.body.style.background;
  const wasDark = documentElement.classList.contains("dark");
  const background = theme.colors.background ?? FALLBACK_TERMINAL_BACKGROUND_HEX;
  const foreground = theme.colors.foreground ?? FALLBACK_TERMINAL_FOREGROUND_HEX;
  const accent = theme.colors.cursor ?? theme.colors.blue ?? foreground;
  const mutedForeground = theme.colors.brightBlack ?? theme.colors.white ?? foreground;

  documentElement.setAttribute(TERMINAL_APPEARANCE_ATTRIBUTE, "");
  documentElement.classList.toggle("dark", !isLightTerminalTheme(theme));
  document.body.style.background = background;
  documentElement.style.setProperty("--localterm-background", background);
  documentElement.style.setProperty("--localterm-foreground", foreground);
  documentElement.style.setProperty("--localterm-accent", accent);
  documentElement.style.setProperty(
    "--localterm-accent-foreground",
    theme.colors.cursorAccent ?? background,
  );
  documentElement.style.setProperty("--localterm-muted-foreground", mutedForeground);
  documentElement.style.setProperty("--localterm-red", theme.colors.red ?? accent);
  documentElement.style.setProperty("--localterm-green", theme.colors.green ?? accent);
  documentElement.style.setProperty("--localterm-yellow", theme.colors.yellow ?? accent);
  documentElement.style.setProperty("--localterm-blue", theme.colors.blue ?? accent);
  documentElement.style.setProperty("--localterm-magenta", theme.colors.magenta ?? accent);
  documentElement.style.setProperty("--localterm-cyan", theme.colors.cyan ?? accent);
  documentElement.style.setProperty("--localterm-font-family", fontFamily);
  if (themeColorMeta) themeColorMeta.content = background;

  return () => {
    documentElement.removeAttribute(TERMINAL_APPEARANCE_ATTRIBUTE);
    documentElement.classList.toggle("dark", wasDark);
    document.body.style.background = previousBodyBackground;
    for (const property of TERMINAL_APPEARANCE_STYLE_PROPERTIES) {
      documentElement.style.removeProperty(property);
    }
    if (themeColorMeta && previousThemeColor !== undefined) {
      themeColorMeta.content = previousThemeColor;
    }
  };
};
