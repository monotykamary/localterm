import { describe, expect, it } from "vite-plus/test";
import { formatWorkingDirectoryTitle } from "../../src/utils/format-working-directory-title.js";

const home = "/Users/tester";

describe("formatWorkingDirectoryTitle", () => {
  it("returns ~ when cwd equals the home directory", () => {
    expect(formatWorkingDirectoryTitle(home, home)).toBe("~");
  });

  it("uses zsh-style ~/... abbreviation under home", () => {
    expect(formatWorkingDirectoryTitle("/Users/tester/Developer/localterm", home)).toBe(
      "…/localterm",
    );
  });

  it("truncates paths with more than one display segment", () => {
    expect(formatWorkingDirectoryTitle("/usr/local/bin", home)).toBe("…/bin");
  });

  it("truncates a path at the segment boundary (2 segments)", () => {
    expect(formatWorkingDirectoryTitle("/Users/tester/Developer", home)).toBe("…/Developer");
  });

  it("truncates deep paths to the last display segment", () => {
    expect(
      formatWorkingDirectoryTitle("/Users/tester/Developer/localterm/packages/server", home),
    ).toBe("…/server");
  });

  it("truncates a path that's exactly one segment over the cap", () => {
    expect(formatWorkingDirectoryTitle("/a/b/c/d", home)).toBe("…/d");
  });

  it("returns the input unchanged when cwd is empty", () => {
    expect(formatWorkingDirectoryTitle("", home)).toBe("");
  });

  it("handles the root path", () => {
    expect(formatWorkingDirectoryTitle("/", home)).toBe("/");
  });

  it("truncates paths outside home to the last display segment", () => {
    expect(formatWorkingDirectoryTitle("/var/log/system.log", home)).toBe("…/system.log");
  });
});
