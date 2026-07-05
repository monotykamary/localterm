import { describe, expect, it } from "vite-plus/test";
import { stripAnsi } from "../../src/utils/strip-ansi.js";

describe("stripAnsi", () => {
  it("strips CSI color sequences and leaves the text", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
  });

  it("strips OSC sequences (e.g. the automation-exit marker)", () => {
    expect(stripAnsi("out\x1b]7777;automation-exit;0\x07")).toBe("out");
  });

  it("strips OSC sequences terminated by ST (ESC backslash)", () => {
    expect(stripAnsi("\x1b]0;title\x1b\\after")).toBe("after");
  });

  it("strips cursor-move and erase sequences", () => {
    expect(stripAnsi("\x1b[2J\x1b[Hcleared")).toBe("cleared");
  });

  it("normalizes CRLF to LF and converts lone CR to LF", () => {
    expect(stripAnsi("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("passes plain text through unchanged", () => {
    expect(stripAnsi("plain text\n")).toBe("plain text\n");
  });
});
