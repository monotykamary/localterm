import type { ITheme } from "@xterm/xterm";
import { hexToLab, labToHex } from "@/utils/rgb-to-lab";

interface Lab {
  l: number;
  a: number;
  b: number;
}

const CUBE_STEPS = 6;
const CUBE_MAX_INDEX = 5;
const GRAYSCALE_STEPS = 24;
const GRAYSCALE_DIVISOR = 25;

const lerpLab = (t: number, lab1: Lab, lab2: Lab): Lab => ({
  l: lab1.l + t * (lab2.l - lab1.l),
  a: lab1.a + t * (lab2.a - lab1.a),
  b: lab1.b + t * (lab2.b - lab1.b),
});

export const generateExtendedPalette = (colors: ITheme, harmonious = false): string[] => {
  const bg = colors.background ?? "#000000";
  const fg = colors.foreground ?? "#ffffff";

  const base8: Lab[] = [
    hexToLab(bg),
    hexToLab(colors.red ?? "#ff0000"),
    hexToLab(colors.green ?? "#00ff00"),
    hexToLab(colors.yellow ?? "#ffff00"),
    hexToLab(colors.blue ?? "#0000ff"),
    hexToLab(colors.magenta ?? "#ff00ff"),
    hexToLab(colors.cyan ?? "#00ffff"),
    hexToLab(fg),
  ];

  const isLightTheme = base8[7].l < base8[0].l;

  if (isLightTheme && !harmonious) {
    const swap = base8[0];
    base8[0] = base8[7];
    base8[7] = swap;
  }

  const extended: string[] = [];

  for (let redIndex = 0; redIndex < CUBE_STEPS; redIndex++) {
    const corner0 = lerpLab(redIndex / CUBE_MAX_INDEX, base8[0], base8[1]);
    const corner1 = lerpLab(redIndex / CUBE_MAX_INDEX, base8[2], base8[3]);
    const corner2 = lerpLab(redIndex / CUBE_MAX_INDEX, base8[4], base8[5]);
    const corner3 = lerpLab(redIndex / CUBE_MAX_INDEX, base8[6], base8[7]);
    for (let greenIndex = 0; greenIndex < CUBE_STEPS; greenIndex++) {
      const mid0 = lerpLab(greenIndex / CUBE_MAX_INDEX, corner0, corner1);
      const mid1 = lerpLab(greenIndex / CUBE_MAX_INDEX, corner2, corner3);
      for (let blueIndex = 0; blueIndex < CUBE_STEPS; blueIndex++) {
        const result = lerpLab(blueIndex / CUBE_MAX_INDEX, mid0, mid1);
        extended.push(labToHex(result));
      }
    }
  }

  for (let shadeIndex = 0; shadeIndex < GRAYSCALE_STEPS; shadeIndex++) {
    const t = (shadeIndex + 1) / GRAYSCALE_DIVISOR;
    extended.push(labToHex(lerpLab(t, base8[0], base8[7])));
  }

  return extended;
};
