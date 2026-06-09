import { describe, expect, it } from "vite-plus/test";
import { generateExtendedPalette } from "../../src/utils/generate-extended-palette";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const VESPER_COLORS = {
  background: "#101010",
  foreground: "#ffffff",
  cursor: "#ffc799",
  cursorAccent: "#101010",
  selectionBackground: "#2a2a2a",
  selectionForeground: "#ffffff",
  black: "#101010",
  red: "#ff8080",
  green: "#99ffe4",
  yellow: "#ffc799",
  blue: "#a0a0a0",
  magenta: "#ffc799",
  cyan: "#99ffe4",
  white: "#ffffff",
  brightBlack: "#505050",
  brightRed: "#ff9999",
  brightGreen: "#b3ffe4",
  brightYellow: "#ffd1a8",
  brightBlue: "#b0b0b0",
  brightMagenta: "#ffc799",
  brightCyan: "#66ddcc",
  brightWhite: "#ffffff",
};

describe("generateExtendedPalette", () => {
  it("produces exactly 240 entries (216 cube + 24 grayscale)", () => {
    const palette = generateExtendedPalette(VESPER_COLORS);
    expect(palette).toHaveLength(240);
  });

  it("every entry is a valid 6-digit hex color", () => {
    const palette = generateExtendedPalette(VESPER_COLORS);
    for (const color of palette) {
      expect(color).toMatch(HEX_COLOR);
    }
  });

  it("color cube indices are deterministic and stable", () => {
    const paletteA = generateExtendedPalette(VESPER_COLORS);
    const paletteB = generateExtendedPalette(VESPER_COLORS);
    expect(paletteA).toEqual(paletteB);
  });

  it("the first cube entry (0,0,0) is close to the theme background", () => {
    const palette = generateExtendedPalette(VESPER_COLORS);
    expect(palette[0]).toBe("#101010");
  });

  it("the last cube entry (5,5,5) is close to the theme foreground", () => {
    const palette = generateExtendedPalette(VESPER_COLORS);
    expect(palette[215]).toBe("#ffffff");
  });

  it("the grayscale ramp starts darker and ends lighter", () => {
    const palette = generateExtendedPalette(VESPER_COLORS);
    const grayscale = palette.slice(216);
    expect(grayscale).toHaveLength(24);
    const firstGray = grayscale[0];
    const lastGray = grayscale[23];
    const firstLuminance = parseInt(firstGray.slice(1, 3), 16);
    const lastLuminance = parseInt(lastGray.slice(1, 3), 16);
    expect(firstLuminance).toBeLessThan(lastLuminance);
  });

  it("different themes produce different palettes", () => {
    const draculaColors = {
      background: "#282a36",
      foreground: "#f8f8f2",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
    };
    const vesperPalette = generateExtendedPalette(VESPER_COLORS);
    const draculaPalette = generateExtendedPalette(draculaColors);
    const identicalCount = vesperPalette.reduce(
      (count, color, index) => count + (color === draculaPalette[index] ? 1 : 0),
      0,
    );
    expect(identicalCount).toBeLessThan(240);
  });

  it("light theme without harmonious swaps fg/bg in the cube corners", () => {
    const lightColors = {
      background: "#fdf6e3",
      foreground: "#073642",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
    };
    const defaultPalette = generateExtendedPalette(lightColors, false);
    const harmoniousPalette = generateExtendedPalette(lightColors, true);
    expect(defaultPalette[0]).not.toBe(harmoniousPalette[0]);
    expect(defaultPalette[0]).toBe("#073642");
    expect(harmoniousPalette[0]).toBe("#fdf6e3");
  });

  it("harmonious mode flag has no effect on dark themes", () => {
    const defaultPalette = generateExtendedPalette(VESPER_COLORS, false);
    const harmoniousPalette = generateExtendedPalette(VESPER_COLORS, true);
    expect(defaultPalette).toEqual(harmoniousPalette);
  });

  it("cube interpolation follows the formula index = 16 + 36*r + 6*g + b", () => {
    const palette = generateExtendedPalette(VESPER_COLORS);
    const indexAt = (redIndex: number, greenIndex: number, blueIndex: number) =>
      36 * redIndex + 6 * greenIndex + blueIndex;
    expect(palette[indexAt(0, 0, 0)]).toBe("#101010");
    expect(palette[indexAt(5, 5, 5)]).toBe("#ffffff");
    expect(palette[indexAt(0, 0, 5)]).toBeDefined();
    expect(palette[indexAt(5, 0, 0)]).toBeDefined();
  });
});
