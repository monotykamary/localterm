import { describe, expect, it } from "vite-plus/test";
import { collapseWhitespace } from "../src/utils/collapse-whitespace.js";

describe("collapseWhitespace", () => {
  it("returns the text unchanged when it has no runs of whitespace", () => {
    expect(collapseWhitespace("pi finished")).toBe("pi finished");
  });

  it("collapses runs of spaces, tabs, and newlines to a single space", () => {
    expect(collapseWhitespace("foo\n\t  bar   baz")).toBe("foo bar baz");
  });

  it("trims leading and trailing whitespace", () => {
    expect(collapseWhitespace("  \n foo bar \n ")).toBe("foo bar");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(collapseWhitespace(" \t\n ")).toBe("");
  });
});
