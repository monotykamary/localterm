import { describe, expect, it } from "vite-plus/test";
import {
  hexToLab,
  labToHex,
  labToRgb,
  labToXyz,
  parseHexToRgb,
  rgbToHex,
  rgbToLab,
  rgbToXyz,
  xyzToLab,
  xyzToRgb,
} from "../../src/utils/rgb-to-lab";

const PAIRS = [
  ["#000000", { r: 0, g: 0, b: 0 }],
  ["#ffffff", { r: 255, g: 255, b: 255 }],
  ["#ff0000", { r: 255, g: 0, b: 0 }],
  ["#00ff00", { r: 0, g: 255, b: 0 }],
  ["#0000ff", { r: 0, g: 0, b: 255 }],
  ["#ffc799", { r: 255, g: 199, b: 153 }],
  ["#50fa7b", { r: 80, g: 250, b: 123 }],
  ["#bd93f9", { r: 189, g: 147, b: 249 }],
  ["#282a36", { r: 40, g: 42, b: 54 }],
] as const;

describe("parseHexToRgb / rgbToHex", () => {
  it.each(PAIRS)("round-trips %s", (hex, rgb) => {
    expect(parseHexToRgb(hex)).toEqual(rgb);
    expect(rgbToHex(rgb)).toBe(hex);
  });

  it("clamps out-of-gamut values", () => {
    expect(rgbToHex({ r: -10, g: 300, b: 128 })).toBe("#00ff80");
  });
});

describe("RGB ↔ Lab round-trip", () => {
  it.each(PAIRS)("round-trips %s within 1 sRGB step", (hex) => {
    const rgb = parseHexToRgb(hex);
    const lab = rgbToLab(rgb);
    const recovered = labToRgb(lab);
    expect(Math.abs(recovered.r - rgb.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(recovered.g - rgb.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(recovered.b - rgb.b)).toBeLessThanOrEqual(1);
  });

  it("round-trips through XYZ", () => {
    const rgb = { r: 128, g: 64, b: 200 };
    const xyz = rgbToXyz(rgb);
    const recovered = xyzToRgb(xyz);
    expect(recovered.r).toBeCloseTo(rgb.r, -0.5);
    expect(recovered.g).toBeCloseTo(rgb.g, -0.5);
    expect(recovered.b).toBeCloseTo(rgb.b, -0.5);
  });

  it("round-trips through Lab via XYZ", () => {
    const xyz = { x: 0.4, y: 0.3, z: 0.5 };
    const lab = xyzToLab(xyz);
    const recovered = labToXyz(lab);
    expect(recovered.x).toBeCloseTo(xyz.x, 6);
    expect(recovered.y).toBeCloseTo(xyz.y, 6);
    expect(recovered.z).toBeCloseTo(xyz.z, 6);
  });
});

describe("hexToLab / labToHex round-trip", () => {
  it.each(PAIRS)("round-trips %s within perceptual tolerance", (hex) => {
    const lab = hexToLab(hex);
    const recovered = labToHex(lab);
    const original = parseHexToRgb(hex);
    const result = parseHexToRgb(recovered);
    expect(Math.abs(result.r - original.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.g - original.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.b - original.b)).toBeLessThanOrEqual(1);
  });
});

describe("CIELAB perceptual properties", () => {
  it("black has L* = 0", () => {
    expect(rgbToLab({ r: 0, g: 0, b: 0 }).l).toBeCloseTo(0, 2);
  });

  it("white has L* = 100", () => {
    expect(rgbToLab({ r: 255, g: 255, b: 255 }).l).toBeCloseTo(100, 2);
  });

  it("CIELAB L* spread for pure hues is less than sRGB luminance spread", () => {
    const redLab = rgbToLab({ r: 255, g: 0, b: 0 });
    const greenLab = rgbToLab({ r: 0, g: 255, b: 0 });
    const blueLab = rgbToLab({ r: 0, g: 0, b: 255 });
    const labSpread =
      Math.max(redLab.l, greenLab.l, blueLab.l) - Math.min(redLab.l, greenLab.l, blueLab.l);
    const srgbLuminance = [0.2126, 0.7152, 0.0722];
    const srgbSpread = Math.max(...srgbLuminance) - Math.min(...srgbLuminance);
    expect(labSpread).toBeLessThan(srgbSpread * 100);
  });
});
