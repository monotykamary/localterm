import type {
  KeyGlyph,
  ModifierState,
  SpecialAction,
} from "@/components/on-screen-keyboard/keyboard-layout";

const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);
const CARRIAGE_RETURN = String.fromCharCode(13);

const isAsciiLetter = (char: string): boolean => /^[a-zA-Z]$/.test(char);

// Ctrl+letter maps to the control code in the low 5 bits of the letter's
// codepoint (Ctrl+A = 0x01 ... Ctrl+Z = 0x1a), the same for upper and lower case.
const controlCodeFor = (char: string): string => String.fromCharCode(char.charCodeAt(0) & 0x1f);

const FUNCTION_KEY_REMAP: Record<string, string> = {
  [ESC + "[A"]: ESC + "[5~",
  [ESC + "[B"]: ESC + "[6~",
  [ESC + "[C"]: ESC + "[F",
  [ESC + "[D"]: ESC + "[H",
};

const applyModifiersToChar = (glyph: KeyGlyph, modifiers: ModifierState): string => {
  if (modifiers.function !== "off") {
    const remapped = FUNCTION_KEY_REMAP[glyph.output];
    if (remapped) return remapped;
  }
  const activeControl = modifiers.control !== "off";
  const activeMeta = modifiers.alternate !== "off" || modifiers.command !== "off";
  const activeShift = modifiers.shift !== "off";
  let base = glyph.output;
  if (activeControl && isAsciiLetter(base)) {
    base = controlCodeFor(base);
  } else if (activeShift && isAsciiLetter(base) && base === base.toLowerCase()) {
    base = base.toUpperCase();
  }
  return activeMeta ? ESC + base : base;
};

const buildSpecialSequence = (action: SpecialAction, modifiers: ModifierState): string => {
  if (action === "backspace" && modifiers.function !== "off") return ESC + "[3~";
  switch (action) {
    case "backspace":
      return DEL;
    case "enter":
      return CARRIAGE_RETURN;
    default:
      return "";
  }
};

export const buildCharOutput = (glyph: KeyGlyph, modifiers: ModifierState): string =>
  applyModifiersToChar(glyph, modifiers);

export const buildSpecialOutput = (action: SpecialAction, modifiers: ModifierState): string =>
  buildSpecialSequence(action, modifiers);
