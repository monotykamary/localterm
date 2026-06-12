import { describe, expect, it } from "vite-plus/test";
import { parseOscDirtyFromChunk } from "../../src/utils/parse-osc-dirty.js";

describe("parseOscDirtyFromChunk", () => {
  it("returns false when no OSC 7777 sequences are present", () => {
    expect(parseOscDirtyFromChunk("hello world")).toBe(false);
  });

  it("detects OSC 7777 with BEL terminator", () => {
    expect(parseOscDirtyFromChunk("\x1b]7777;git-dirty\x07")).toBe(true);
  });

  it("detects OSC 7777 with ST terminator", () => {
    expect(parseOscDirtyFromChunk("\x1b]7777;git-dirty\x1b\\")).toBe(true);
  });

  it("detects OSC 7777 embedded in other output", () => {
    expect(parseOscDirtyFromChunk("some output\x1b]7777;git-dirty\x07more output")).toBe(true);
  });

  it("returns false for OSC 7 (cwd) sequences", () => {
    expect(parseOscDirtyFromChunk("\x1b]7;file://localhost/Users\x07")).toBe(false);
  });

  it("returns false for OSC 9 (notification) sequences", () => {
    expect(parseOscDirtyFromChunk("\x1b]9;hello\x07")).toBe(false);
  });

  it("returns false for OSC 0 (title) sequences", () => {
    expect(parseOscDirtyFromChunk("\x1b]0;title\x07")).toBe(false);
  });
});
