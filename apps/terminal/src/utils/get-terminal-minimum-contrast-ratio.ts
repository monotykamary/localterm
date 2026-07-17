import type { TerminalTheme } from "@/lib/terminal-themes";
import {
  DISABLED_TERMINAL_MINIMUM_CONTRAST_RATIO,
  LIGHT_TERMINAL_MINIMUM_CONTRAST_RATIO,
} from "@/lib/constants";
import { isLightTerminalTheme } from "@/utils/is-light-terminal-theme";

export const getTerminalMinimumContrastRatio = (theme: TerminalTheme): number =>
  isLightTerminalTheme(theme)
    ? LIGHT_TERMINAL_MINIMUM_CONTRAST_RATIO
    : DISABLED_TERMINAL_MINIMUM_CONTRAST_RATIO;
