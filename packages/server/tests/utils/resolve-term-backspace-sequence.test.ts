import { describe, expect, it } from "vite-plus/test";
import { resolveTermBackspaceSequence } from "../../src/utils/resolve-term-backspace-sequence.js";

describe("resolveTermBackspaceSequence", () => {
  it("uses Ctrl-H on macOS", () => {
    expect(resolveTermBackspaceSequence("darwin")).toBe("\b");
  });

  it("uses DEL on other supported platforms", () => {
    expect(resolveTermBackspaceSequence("linux")).toBe("\x7f");
  });
});
