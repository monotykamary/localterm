import { describe, expect, it } from "vite-plus/test";
import type { TerminalTheme } from "../../src/lib/terminal-themes";
import { isLightTerminalTheme } from "../../src/utils/is-light-terminal-theme";

const buildTheme = (background?: string): TerminalTheme => ({
  id: "custom",
  name: "Custom",
  source: "test",
  colors: background ? { background } : {},
});

describe("isLightTerminalTheme", () => {
  it("detects light custom backgrounds from their actual color", () => {
    expect(isLightTerminalTheme(buildTheme("#ffffff"))).toBe(true);
    expect(isLightTerminalTheme(buildTheme("#fdf6e3cc"))).toBe(true);
  });

  it("keeps dark and missing custom backgrounds in dark mode", () => {
    expect(isLightTerminalTheme(buildTheme("#101010"))).toBe(false);
    expect(isLightTerminalTheme(buildTheme())).toBe(false);
  });
});
