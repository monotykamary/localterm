import type {
  KeyGlyph,
  ModifierState,
  SpecialAction,
} from "@/components/on-screen-keyboard/keyboard-layout";
import {
  TERMINAL_BACKSPACE_SEQUENCE,
  TERMINAL_CARRIAGE_RETURN_SEQUENCE,
  TERMINAL_ESCAPE_SEQUENCE,
} from "@/lib/constants";
import { buildTerminalEditingOutput } from "@/utils/build-terminal-editing-output";

const isAsciiLetter = (char: string): boolean => /^[a-zA-Z]$/.test(char);

// Ctrl+letter maps to the control code in the low 5 bits of the letter's
// codepoint (Ctrl+A = 0x01 ... Ctrl+Z = 0x1a), the same for upper and lower case.
const controlCodeFor = (char: string): string => String.fromCharCode(char.charCodeAt(0) & 0x1f);

// fn+arrow remaps to the macOS navigation keys (page up/down, home/end). Takes
// precedence over the word and line movement mappings below so fn always navigates.
const FUNCTION_KEY_REMAP: Record<string, string> = {
  [TERMINAL_ESCAPE_SEQUENCE + "[A"]: TERMINAL_ESCAPE_SEQUENCE + "[5~",
  [TERMINAL_ESCAPE_SEQUENCE + "[B"]: TERMINAL_ESCAPE_SEQUENCE + "[6~",
  [TERMINAL_ESCAPE_SEQUENCE + "[C"]: TERMINAL_ESCAPE_SEQUENCE + "[F",
  [TERMINAL_ESCAPE_SEQUENCE + "[D"]: TERMINAL_ESCAPE_SEQUENCE + "[H",
};

// Arrow glyphs arrive as bare CSI sequences. Option/Control map to readline's
// ESC b/f word movement; Command maps to Ctrl+A/E line boundaries. Both forms
// are understood by bash and pi, unlike xterm modifier CSI sequences such as
// ESC[1;3D, whose unbound tail is inserted as ";3D" by default macOS bash.
// Up/down retain their bare history behavior unless Command maps them to a line
// boundary, and Shift-only arrows remain bare because readline cannot select.
const ARROW_KEY_BY_OUTPUT: Record<string, string> = {
  [TERMINAL_ESCAPE_SEQUENCE + "[A"]: "ArrowUp",
  [TERMINAL_ESCAPE_SEQUENCE + "[B"]: "ArrowDown",
  [TERMINAL_ESCAPE_SEQUENCE + "[C"]: "ArrowRight",
  [TERMINAL_ESCAPE_SEQUENCE + "[D"]: "ArrowLeft",
};

const modifierIsActive = (mode: ModifierState[keyof ModifierState]): boolean => mode !== "off";

const terminalEditingOutputFor = (key: string, modifiers: ModifierState): string | null =>
  buildTerminalEditingOutput({
    key,
    alternate: modifierIsActive(modifiers.alternate),
    command: modifierIsActive(modifiers.command),
    control: modifierIsActive(modifiers.control),
  });

const applyModifiersToChar = (glyph: KeyGlyph, modifiers: ModifierState): string => {
  if (modifierIsActive(modifiers.function)) {
    const remapped = FUNCTION_KEY_REMAP[glyph.output];
    if (remapped) return remapped;
  }
  const arrowKey = ARROW_KEY_BY_OUTPUT[glyph.output];
  if (arrowKey) return terminalEditingOutputFor(arrowKey, modifiers) ?? glyph.output;

  const activeControl = modifierIsActive(modifiers.control);
  const activeMeta = modifierIsActive(modifiers.alternate) || modifierIsActive(modifiers.command);
  const activeShift = modifierIsActive(modifiers.shift);
  let base = glyph.output;
  if (activeControl && isAsciiLetter(base)) {
    base = controlCodeFor(base);
  } else if (activeShift && isAsciiLetter(base) && base === base.toLowerCase()) {
    base = base.toUpperCase();
  }
  return activeMeta ? TERMINAL_ESCAPE_SEQUENCE + base : base;
};

const buildSpecialSequence = (action: SpecialAction, modifiers: ModifierState): string => {
  if (action === "backspace") {
    if (modifierIsActive(modifiers.function)) return TERMINAL_ESCAPE_SEQUENCE + "[3~";
    const terminalEditingOutput = terminalEditingOutputFor("Backspace", modifiers);
    if (terminalEditingOutput !== null) return terminalEditingOutput;
  }
  switch (action) {
    case "backspace":
      return TERMINAL_BACKSPACE_SEQUENCE;
    case "enter":
      return TERMINAL_CARRIAGE_RETURN_SEQUENCE;
    default:
      return "";
  }
};

export const buildCharOutput = (glyph: KeyGlyph, modifiers: ModifierState): string =>
  applyModifiersToChar(glyph, modifiers);

export const buildSpecialOutput = (action: SpecialAction, modifiers: ModifierState): string =>
  buildSpecialSequence(action, modifiers);
