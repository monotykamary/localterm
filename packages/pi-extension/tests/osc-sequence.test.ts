import { describe, expect, it } from "vite-plus/test";
import { buildOsc9Sequence } from "../src/utils/osc-sequence.js";

describe("buildOsc9Sequence", () => {
  it("wraps the body in an OSC 9 prefix and BEL terminator", () => {
    expect(buildOsc9Sequence("hello")).toBe("\x1b]9;hello\x07");
  });

  it("replaces control chars and DEL with spaces so they cannot break OSC framing", () => {
    expect(buildOsc9Sequence("a\x07b\x1bc")).toBe("\x1b]9;a b c\x07");
  });

  it("collapses runs of whitespace and trims", () => {
    expect(buildOsc9Sequence("  foo\n\tbar  ")).toBe("\x1b]9;foo bar\x07");
  });

  it("caps the body to maxLength code units", () => {
    expect(buildOsc9Sequence("x".repeat(10), 5)).toBe("\x1b]9;xxxxx\x07");
  });

  it("preserves unicode characters", () => {
    expect(buildOsc9Sequence("héllo·世界")).toBe("\x1b]9;héllo·世界\x07");
  });

  it("emits an empty payload when the body sanitizes to nothing", () => {
    expect(buildOsc9Sequence("   \x07\x1b   ")).toBe("\x1b]9;\x07");
  });
});
