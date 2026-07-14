import { describe, expect, it } from "vite-plus/test";
import type {
  KeyGlyph,
  ModifierState,
} from "../../src/components/on-screen-keyboard/keyboard-layout";
import { buildCharOutput, buildSpecialOutput } from "../../src/utils/build-keyboard-output";

const ESC = String.fromCharCode(27);
const off: ModifierState = {
  shift: "off",
  control: "off",
  alternate: "off",
  command: "off",
  function: "off",
};
const on = (overrides: Partial<ModifierState>): ModifierState => ({ ...off, ...overrides });

const glyph = (label: string, output: string): KeyGlyph => ({ label, output });
const up = glyph("up", ESC + "[A");
const down = glyph("down", ESC + "[B");
const right = glyph("right", ESC + "[C");
const left = glyph("left", ESC + "[D");

describe("buildCharOutput arrow editing", () => {
  it("emits the bare CSI for an unmodified arrow", () => {
    expect(buildCharOutput(up, off)).toBe(ESC + "[A");
    expect(buildCharOutput(left, off)).toBe(ESC + "[D");
  });

  it("maps Alt+left/right to readline word movement (ESC b / ESC f)", () => {
    expect(buildCharOutput(left, on({ alternate: "oneShot" }))).toBe(ESC + "b");
    expect(buildCharOutput(right, on({ alternate: "locked" }))).toBe(ESC + "f");
  });

  it("maps Control+left/right to the same word movement", () => {
    expect(buildCharOutput(left, on({ control: "oneShot" }))).toBe(ESC + "b");
    expect(buildCharOutput(right, on({ control: "locked" }))).toBe(ESC + "f");
  });

  it("maps Command arrows to line boundaries", () => {
    expect(buildCharOutput(left, on({ command: "oneShot" }))).toBe(String.fromCharCode(1));
    expect(buildCharOutput(up, on({ command: "locked" }))).toBe(String.fromCharCode(1));
    expect(buildCharOutput(right, on({ command: "oneShot" }))).toBe(String.fromCharCode(5));
    expect(buildCharOutput(down, on({ command: "locked" }))).toBe(String.fromCharCode(5));
  });

  it("word-movement arrows are byte-identical to Alt+b/f", () => {
    const b = glyph("b", "b");
    const f = glyph("f", "f");
    expect(buildCharOutput(left, on({ alternate: "oneShot" }))).toBe(
      buildCharOutput(b, on({ alternate: "oneShot" })),
    );
    expect(buildCharOutput(right, on({ alternate: "oneShot" }))).toBe(
      buildCharOutput(f, on({ alternate: "oneShot" })),
    );
  });

  it("falls back to the bare arrow for Alt/Control + up/down", () => {
    expect(buildCharOutput(up, on({ control: "oneShot" }))).toBe(ESC + "[A");
    expect(buildCharOutput(down, on({ alternate: "locked" }))).toBe(ESC + "[B");
  });

  it("falls back to the bare arrow for Shift+arrow", () => {
    expect(buildCharOutput(left, on({ shift: "oneShot" }))).toBe(ESC + "[D");
    expect(buildCharOutput(up, on({ shift: "locked" }))).toBe(ESC + "[A");
  });

  it("ignores shift when another editing modifier is also held", () => {
    expect(buildCharOutput(left, on({ alternate: "oneShot", shift: "locked" }))).toBe(ESC + "b");
    expect(buildCharOutput(right, on({ command: "oneShot", shift: "locked" }))).toBe(
      String.fromCharCode(5),
    );
  });

  it("does not emit xterm modifier forms that leak into bash", () => {
    expect(buildCharOutput(left, on({ alternate: "oneShot" }))).not.toContain(";3");
    expect(buildCharOutput(left, on({ command: "oneShot" }))).not.toContain(";9");
    expect(buildCharOutput(left, on({ control: "oneShot" }))).not.toContain(";5");
  });

  it("remaps fn+arrow to navigation keys regardless of other modifiers", () => {
    expect(buildCharOutput(left, on({ function: "oneShot" }))).toBe(ESC + "[H");
    expect(buildCharOutput(right, on({ function: "oneShot" }))).toBe(ESC + "[F");
    expect(buildCharOutput(up, on({ function: "locked" }))).toBe(ESC + "[5~");
    expect(buildCharOutput(down, on({ function: "locked" }))).toBe(ESC + "[6~");
    expect(buildCharOutput(left, on({ function: "oneShot", command: "oneShot" }))).toBe(ESC + "[H");
  });
});

describe("buildCharOutput letter modifiers", () => {
  it("sends a bare letter with no modifiers", () => {
    expect(buildCharOutput(glyph("a", "a"), off)).toBe("a");
  });

  it("promotes a letter under shift", () => {
    expect(buildCharOutput(glyph("a", "a"), on({ shift: "oneShot" }))).toBe("A");
  });

  it("maps Ctrl+letter to its control code", () => {
    expect(buildCharOutput(glyph("a", "a"), on({ control: "oneShot" }))).toBe(
      String.fromCharCode(1),
    );
  });

  it("prefixes Alt/Cmd letters with ESC (meta)", () => {
    expect(buildCharOutput(glyph("b", "b"), on({ alternate: "oneShot" }))).toBe(ESC + "b");
    expect(buildCharOutput(glyph("b", "b"), on({ command: "locked" }))).toBe(ESC + "b");
  });
});

describe("buildSpecialOutput", () => {
  it("emits DEL for backspace", () => {
    expect(buildSpecialOutput("backspace", off)).toBe(String.fromCharCode(127));
  });

  it("maps Command+Backspace to delete-to-line-start", () => {
    expect(buildSpecialOutput("backspace", on({ command: "oneShot" }))).toBe(
      String.fromCharCode(21),
    );
  });

  it("emits CR for enter", () => {
    expect(buildSpecialOutput("enter", off)).toBe(String.fromCharCode(13));
  });

  it("remaps fn+backspace to the forward-delete CSI", () => {
    expect(buildSpecialOutput("backspace", on({ function: "oneShot" }))).toBe(ESC + "[3~");
  });
});
