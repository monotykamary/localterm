import type { TerminalTheme } from "@/lib/terminal-themes";
import {
  DARK_TERMINAL_THEME_LIGHTNESS_THRESHOLD_PERCENT,
  FALLBACK_TERMINAL_BACKGROUND_HEX,
} from "@/lib/constants";
import { hexToLab } from "@/utils/rgb-to-lab";
import { toOpaqueHexColor } from "@/utils/to-opaque-hex-color";

export const isLightTerminalTheme = (theme: TerminalTheme): boolean => {
  const background = theme.colors.background ?? FALLBACK_TERMINAL_BACKGROUND_HEX;
  return (
    hexToLab(toOpaqueHexColor(background)).l >= DARK_TERMINAL_THEME_LIGHTNESS_THRESHOLD_PERCENT
  );
};
