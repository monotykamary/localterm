import { describe, expect, it } from "vite-plus/test";
import { parseOscForegroundFromChunk } from "../../src/utils/parse-osc-foreground.js";

describe("parseOscForegroundFromChunk", () => {
  it("returns undefined when no foreground signal is present", () => {
    expect(parseOscForegroundFromChunk("hello world")).toBe(undefined);
  });

  it("detects a foreground program with BEL terminator", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg;vim\x07")).toBe("vim");
  });

  it("detects a foreground program with ST terminator", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg;vim\x1b\\")).toBe("vim");
  });

  it("detects idle with BEL terminator", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg-idle\x07")).toBe(null);
  });

  it("detects idle with ST terminator", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg-idle\x1b\\")).toBe(null);
  });

  it("detects a signal embedded in other output", () => {
    expect(parseOscForegroundFromChunk("some output\x1b]7777;fg;pi\x07more output")).toBe("pi");
  });

  it("returns the last signal when several appear in one chunk", () => {
    const chunk = "\x1b]7777;fg;vim\x07\x1b]7777;fg-idle\x07";
    expect(parseOscForegroundFromChunk(chunk)).toBe(null);
  });

  it("cuts the token at a shell separator", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg;a;b\x07")).toBe("a");
  });

  it("strips control characters from the token", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg;v\x01im\x07")).toBe("v");
  });

  it("trims surrounding whitespace", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg;  vim  \x07")).toBe("vim");
  });

  it("ignores an empty foreground token", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg;\x07")).toBe(undefined);
  });

  it("ignores git-dirty and automation-exit signals", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;git-dirty\x07")).toBe(undefined);
    expect(parseOscForegroundFromChunk("\x1b]7777;automation-exit;0\x07")).toBe(undefined);
  });

  it("ignores OSC 7 (cwd) and OSC 0 (title) sequences", () => {
    expect(parseOscForegroundFromChunk("\x1b]7;file://localhost/Users\x07")).toBe(undefined);
    expect(parseOscForegroundFromChunk("\x1b]0;title\x07")).toBe(undefined);
  });

  it("returns undefined for an incomplete OSC (no terminator)", () => {
    expect(parseOscForegroundFromChunk("\x1b]7777;fg;vim")).toBe(undefined);
  });

  it("caps the token at MAX_FOREGROUND_LENGTH", () => {
    const long = "x".repeat(1000);
    const parsed = parseOscForegroundFromChunk("\x1b]7777;fg;" + long + "\x07");
    expect(parsed).toBe("x".repeat(256));
  });
});
