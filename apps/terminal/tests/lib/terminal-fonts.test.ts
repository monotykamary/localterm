import { describe, expect, it } from "vite-plus/test";
import {
  CUSTOM_FONT_ID,
  DEFAULT_TERMINAL_FONT_ID,
  TERMINAL_FONTS,
  buildCustomTerminalFont,
  findTerminalFontById,
} from "../../src/lib/terminal-fonts";

describe("terminal-fonts registry", () => {
  it("ships with several distinct monospace fonts", () => {
    expect(TERMINAL_FONTS.length).toBeGreaterThanOrEqual(8);
    const ids = new Set(TERMINAL_FONTS.map((font) => font.id));
    expect(ids.size).toBe(TERMINAL_FONTS.length);
  });

  it("exposes the default font id and it resolves to a real font", () => {
    const font = findTerminalFontById(DEFAULT_TERMINAL_FONT_ID);
    expect(font.id).toBe(DEFAULT_TERMINAL_FONT_ID);
  });

  it("falls back to the default font for null, undefined, or unknown ids", () => {
    expect(findTerminalFontById(null).id).toBe(DEFAULT_TERMINAL_FONT_ID);
    expect(findTerminalFontById(undefined).id).toBe(DEFAULT_TERMINAL_FONT_ID);
    expect(findTerminalFontById("not-a-real-font").id).toBe(DEFAULT_TERMINAL_FONT_ID);
  });

  it.each(TERMINAL_FONTS.map((font) => [font.id, font] as const))(
    "%s declares a CSS family with monospace fallback",
    (_id, font) => {
      expect(font.family.length).toBeGreaterThan(0);
      expect(font.family).toContain("monospace");
      // All shipped fonts are bundled via fontsource (no runtime network fetch),
      // so they render on an air-gapped host.
      expect(font.source).toBe("fontsource");
    },
  );

  it("builds a custom font from a user-entered family name resolved by the OS", () => {
    const font = buildCustomTerminalFont("JetBrainsMono Nerd Font Mono");
    expect(font.id).toBe(CUSTOM_FONT_ID);
    expect(font.source).toBe("custom");
    expect(font.name).toBe("JetBrainsMono Nerd Font Mono");
    // The primary family is quoted, the Nerd Font symbols face is appended, and
    // the generic monospace fallback anchors the stack.
    expect(font.family).toContain('"JetBrainsMono Nerd Font Mono"');
    expect(font.family).toContain("Symbols Nerd Font");
    expect(font.family).toContain("monospace");
  });

  it("escapes a custom family name containing a CSS-significant quote", () => {
    const font = buildCustomTerminalFont('Bad"Name');
    // The quote is escaped so it can't break out of the quoted family string.
    expect(font.family).not.toContain('"Bad"Name"');
  });

  it("falls back to the default family when the custom name is blank", () => {
    const font = buildCustomTerminalFont("   ");
    expect(font.id).toBe(CUSTOM_FONT_ID);
    // A blank field resolves to the default's primary family, never a bare
    // fallback chain — so the terminal still renders the bundled default.
    expect(font.family).toContain("Geist Mono");
  });
});
