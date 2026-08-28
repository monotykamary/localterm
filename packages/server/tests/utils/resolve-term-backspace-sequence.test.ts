import { describe, expect, it } from "vite-plus/test";
import { resolveTermBackspaceSequence } from "../../src/utils/resolve-term-backspace-sequence.js";

describe("resolveTermBackspaceSequence", () => {
  it("uses DEL to match xterm.js and the PTY erase character", () => {
    expect(resolveTermBackspaceSequence()).toBe("\x7f");
  });
});
