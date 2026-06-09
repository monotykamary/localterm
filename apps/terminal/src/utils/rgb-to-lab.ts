const SRGB_TO_LINEAR_EXPONENT = 2.4;
const SRGB_THRESHOLD = 0.04045;
const SRGB_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_ALPHA = 1.055;
const SRGB_LINEAR_TO_GAMMA_THRESHOLD = 0.0031308;

const CIE_KAPPA = 24389 / 27;
const CIE_EPSILON = 216 / 24389;

const D65_X = 0.9642;
const D65_Y = 1.0;
const D65_Z = 0.8249;

const LAB_CUBE_ROOT_THRESHOLD = 0.008856;
const LAB_CUBE_ROOT_COEFFICIENT = 7.787;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

interface Xyz {
  x: number;
  y: number;
  z: number;
}

const srgbChannelToLinear = (channel: number): number => {
  const normalized = channel / 255;
  if (normalized <= SRGB_THRESHOLD) return normalized / SRGB_DIVISOR;
  return Math.pow((normalized + SRGB_OFFSET) / SRGB_ALPHA, SRGB_TO_LINEAR_EXPONENT);
};

const linearToSrgbChannel = (linear: number): number => {
  if (linear <= 0) return 0;
  if (linear >= 1) return 255;
  if (linear <= SRGB_LINEAR_TO_GAMMA_THRESHOLD) return Math.round(SRGB_DIVISOR * linear * 255);
  return Math.round(
    (SRGB_ALPHA * Math.pow(linear, 1 / SRGB_TO_LINEAR_EXPONENT) - SRGB_OFFSET) * 255,
  );
};

const xyzF = (channel: number): number =>
  channel > LAB_CUBE_ROOT_THRESHOLD
    ? Math.cbrt(channel)
    : LAB_CUBE_ROOT_COEFFICIENT * channel + 16 / 116;

export const rgbToXyz = (rgb: Rgb): Xyz => {
  const linearR = srgbChannelToLinear(rgb.r);
  const linearG = srgbChannelToLinear(rgb.g);
  const linearB = srgbChannelToLinear(rgb.b);

  return {
    x: 0.4124564 * linearR + 0.3575761 * linearG + 0.1804375 * linearB,
    y: 0.2126729 * linearR + 0.7151522 * linearG + 0.072175 * linearB,
    z: 0.0193339 * linearR + 0.119192 * linearG + 0.9503041 * linearB,
  };
};

export const xyzToRgb = (xyz: Xyz): Rgb => {
  const linearR = 3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z;
  const linearG = -0.969266 * xyz.x + 1.8760108 * xyz.y + 0.041556 * xyz.z;
  const linearB = 0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z;

  return {
    r: linearToSrgbChannel(linearR),
    g: linearToSrgbChannel(linearG),
    b: linearToSrgbChannel(linearB),
  };
};

export const xyzToLab = (xyz: Xyz): Lab => {
  const scaledX = xyz.x / D65_X;
  const scaledY = xyz.y / D65_Y;
  const scaledZ = xyz.z / D65_Z;

  const fX = xyzF(scaledX);
  const fY = xyzF(scaledY);
  const fZ = xyzF(scaledZ);

  return {
    l: 116 * fY - 16,
    a: 500 * (fX - fY),
    b: 200 * (fY - fZ),
  };
};

export const labToXyz = (lab: Lab): Xyz => {
  const fY = (lab.l + 16) / 116;
  const fX = lab.a / 500 + fY;
  const fZ = fY - lab.b / 200;

  if (lab.l > CIE_KAPPA * CIE_EPSILON) {
    return {
      x: D65_X * fX * fX * fX,
      y: D65_Y * fY * fY * fY,
      z: D65_Z * fZ * fZ * fZ,
    };
  }

  return {
    x: D65_X * ((116 * fX - 16) / CIE_KAPPA),
    y: D65_Y * (lab.l / CIE_KAPPA),
    z: D65_Z * ((116 * fZ - 16) / CIE_KAPPA),
  };
};

export const rgbToLab = (rgb: Rgb): Lab => xyzToLab(rgbToXyz(rgb));

export const labToRgb = (lab: Lab): Rgb => xyzToRgb(labToXyz(lab));

export const parseHexToRgb = (hex: string): Rgb => {
  const cleaned = hex.replace(/^#/, "");
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
};

export const rgbToHex = (rgb: Rgb): string => {
  const clampedR = Math.max(0, Math.min(255, Math.round(rgb.r)));
  const clampedG = Math.max(0, Math.min(255, Math.round(rgb.g)));
  const clampedB = Math.max(0, Math.min(255, Math.round(rgb.b)));
  return `#${clampedR.toString(16).padStart(2, "0")}${clampedG.toString(16).padStart(2, "0")}${clampedB.toString(16).padStart(2, "0")}`;
};

export const hexToLab = (hex: string): Lab => rgbToLab(parseHexToRgb(hex));

export const labToHex = (lab: Lab): string => rgbToHex(labToRgb(lab));
