import { describe, expect, it } from "vite-plus/test";
import { parseGitHubPrUrl } from "../../src/utils/parse-pr-url.js";

describe("parseGitHubPrUrl", () => {
  it("parses owner, repo, and number", () => {
    expect(parseGitHubPrUrl("https://github.com/foo/bar/pull/123")).toEqual({
      owner: "foo",
      repo: "bar",
      number: 123,
    });
  });

  it("accepts a trailing slash", () => {
    expect(parseGitHubPrUrl("https://github.com/foo/bar/pull/123/")).toEqual({
      owner: "foo",
      repo: "bar",
      number: 123,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseGitHubPrUrl("  https://github.com/foo/bar/pull/7  ")).toEqual({
      owner: "foo",
      repo: "bar",
      number: 7,
    });
  });

  it("rejects a URL that is not a pull request", () => {
    expect(parseGitHubPrUrl("https://github.com/foo/bar/issues/123")).toBeNull();
    expect(parseGitHubPrUrl("https://github.com/foo/bar")).toBeNull();
    expect(parseGitHubPrUrl("https://github.com/foo/bar/commit/abc")).toBeNull();
  });

  it("rejects a non-github URL", () => {
    expect(parseGitHubPrUrl("https://gitlab.com/foo/bar/pull/123")).toBeNull();
  });

  it("rejects a non-positive PR number", () => {
    expect(parseGitHubPrUrl("https://github.com/foo/bar/pull/0")).toBeNull();
    expect(parseGitHubPrUrl("https://github.com/foo/bar/pull/abc")).toBeNull();
  });
});
