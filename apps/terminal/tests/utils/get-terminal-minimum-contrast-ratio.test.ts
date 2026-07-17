import { describe, expect, it } from "vite-plus/test";
import type { TerminalTheme } from "../../src/lib/terminal-themes";
import {
  DISABLED_TERMINAL_MINIMUM_CONTRAST_RATIO,
  LIGHT_TERMINAL_MINIMUM_CONTRAST_RATIO,
} from "../../src/lib/constants";
import { getTerminalMinimumContrastRatio } from "../../src/utils/get-terminal-minimum-contrast-ratio";

const buildTheme = (background: string): TerminalTheme => ({
  id: "custom",
  name: "Custom",
  source: "test",
  colors: { background },
});

describe("getTerminalMinimumContrastRatio", () => {
  it("enforces accessible contrast for light themes", () => {
    expect(getTerminalMinimumContrastRatio(buildTheme("#ffffff"))).toBe(
      LIGHT_TERMINAL_MINIMUM_CONTRAST_RATIO,
    );
  });

  it("preserves palette colors for dark themes", () => {
    expect(getTerminalMinimumContrastRatio(buildTheme("#101010"))).toBe(
      DISABLED_TERMINAL_MINIMUM_CONTRAST_RATIO,
    );
  });
});
