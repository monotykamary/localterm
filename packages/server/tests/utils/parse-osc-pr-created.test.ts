import { describe, expect, it } from "vite-plus/test";
import { parseOscPrCreatedFromChunk } from "../../src/utils/parse-osc-pr-created.js";

describe("parseOscPrCreatedFromChunk", () => {
  it("returns null when no pr-created sequence is present", () => {
    expect(parseOscPrCreatedFromChunk("hello world")).toBeNull();
    expect(parseOscPrCreatedFromChunk("\x1b]7777;git-dirty\x07")).toBeNull();
  });

  it("extracts the URL with a BEL terminator", () => {
    expect(
      parseOscPrCreatedFromChunk("\x1b]7777;pr-created;https://github.com/foo/bar/pull/123\x07"),
    ).toBe("https://github.com/foo/bar/pull/123");
  });

  it("extracts the URL with an ST terminator", () => {
    expect(
      parseOscPrCreatedFromChunk("\x1b]7777;pr-created;https://github.com/foo/bar/pull/123\x1b\\"),
    ).toBe("https://github.com/foo/bar/pull/123");
  });

  it("extracts the URL embedded in other output", () => {
    expect(
      parseOscPrCreatedFromChunk(
        "some output\x1b]7777;pr-created;https://github.com/foo/bar/pull/7\x07more output",
      ),
    ).toBe("https://github.com/foo/bar/pull/7");
  });

  it("ignores other OSC 7777 payloads", () => {
    expect(parseOscPrCreatedFromChunk("\x1b]7777;git-dirty\x07")).toBeNull();
    expect(parseOscPrCreatedFromChunk("\x1b]7777;automation-exit;0\x07")).toBeNull();
  });

  it("ignores an empty payload", () => {
    expect(parseOscPrCreatedFromChunk("\x1b]7777;pr-created;\x07")).toBeNull();
  });
});
