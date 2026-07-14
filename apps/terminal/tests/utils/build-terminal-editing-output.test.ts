import { describe, expect, it } from "vite-plus/test";
import { buildTerminalEditingOutput } from "../../src/utils/build-terminal-editing-output";

const NO_MODIFIERS = {
  alternate: false,
  command: false,
  control: false,
};

const outputFor = (key: string, overrides: Partial<typeof NO_MODIFIERS> = {}): string | null =>
  buildTerminalEditingOutput({ key, ...NO_MODIFIERS, ...overrides });

describe("buildTerminalEditingOutput", () => {
  it("leaves unmodified and unrelated keys to xterm", () => {
    expect(outputFor("ArrowLeft")).toBeNull();
    expect(outputFor("Backspace", { alternate: true })).toBeNull();
    expect(outputFor("ArrowUp", { alternate: true })).toBeNull();
  });

  it("maps Option+Left/Right to readline word movement", () => {
    expect(outputFor("ArrowLeft", { alternate: true })).toBe(String.fromCharCode(27) + "b");
    expect(outputFor("ArrowRight", { alternate: true })).toBe(String.fromCharCode(27) + "f");
  });

  it("maps Control+Left/Right to the same portable word movement", () => {
    expect(outputFor("ArrowLeft", { control: true })).toBe(String.fromCharCode(27) + "b");
    expect(outputFor("ArrowRight", { control: true })).toBe(String.fromCharCode(27) + "f");
  });

  it("maps Command+Left/Up and Right/Down to line boundaries", () => {
    expect(outputFor("ArrowLeft", { command: true })).toBe(String.fromCharCode(1));
    expect(outputFor("ArrowUp", { command: true })).toBe(String.fromCharCode(1));
    expect(outputFor("ArrowRight", { command: true })).toBe(String.fromCharCode(5));
    expect(outputFor("ArrowDown", { command: true })).toBe(String.fromCharCode(5));
  });

  it("maps Command+Backspace to delete-to-line-start", () => {
    expect(outputFor("Backspace", { command: true })).toBe(String.fromCharCode(21));
  });

  it("gives Command precedence over Option and Control", () => {
    expect(outputFor("ArrowLeft", { alternate: true, command: true, control: true })).toBe(
      String.fromCharCode(1),
    );
  });
});
