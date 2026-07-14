import { describe, expect, it } from "vite-plus/test";
import { isLikelyRelativePath } from "../../src/utils/is-likely-relative-path";

describe("isLikelyRelativePath", () => {
  it("accepts a nested repo-relative path", () => {
    expect(isLikelyRelativePath("apps/terminal/src/foo.ts")).toBe(true);
  });

  it("accepts a ./prefixed relative path", () => {
    expect(isLikelyRelativePath("./src/foo.ts")).toBe(true);
  });

  it("accepts a bare filename with an extension", () => {
    expect(isLikelyRelativePath("README.md")).toBe(true);
  });

  it("rejects a directory without an extension", () => {
    expect(isLikelyRelativePath("src/lib")).toBe(false);
  });

  it("rejects a shell command with a space", () => {
    expect(isLikelyRelativePath("npm install")).toBe(false);
  });

  it("rejects a leading-dash flag", () => {
    expect(isLikelyRelativePath("--foo")).toBe(false);
  });

  it("rejects an absolute path", () => {
    expect(isLikelyRelativePath("/etc/passwd")).toBe(false);
  });

  it("rejects a home-relative path", () => {
    expect(isLikelyRelativePath("~/secrets.txt")).toBe(false);
  });

  it("rejects a traversal path", () => {
    expect(isLikelyRelativePath("../secrets.txt")).toBe(false);
    expect(isLikelyRelativePath("src/../etc/passwd")).toBe(false);
  });

  it("rejects a URL", () => {
    expect(isLikelyRelativePath("https://example.com/x.ts")).toBe(false);
  });

  it("rejects a token with shell metacharacters", () => {
    expect(isLikelyRelativePath("src/foo.ts;rm -rf /")).toBe(false);
    expect(isLikelyRelativePath("src/foo|bar.ts")).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(isLikelyRelativePath("")).toBe(false);
  });
});
