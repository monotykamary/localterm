export const buildKittyKeySequence = (keyCode: number, modifierBits: number): string =>
  `\x1b[${keyCode};${modifierBits + 1}u`;
