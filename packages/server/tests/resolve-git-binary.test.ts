import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import {
  gitBinaryCandidates,
  resolveGitBinary,
  selectUsableGitBinary,
} from "../src/utils/resolve-git-binary.js";

describe("gitBinaryCandidates", () => {
  it("probes the Apple-signed system git first", () => {
    expect(gitBinaryCandidates(null)[0]).toBe("/usr/bin/git");
  });

  it("probes the active developer dir's git before the homebrew prefixes", () => {
    const candidates = gitBinaryCandidates("/Applications/Xcode.app/Contents/Developer");
    const xcodeGit = "/Applications/Xcode.app/Contents/Developer/usr/bin/git";
    expect(candidates).toContain(xcodeGit);
    expect(candidates.indexOf(xcodeGit)).toBeLessThan(candidates.indexOf("/opt/homebrew/bin/git"));
  });

  it("omits the developer-dir candidate when no developer dir resolves", () => {
    expect(gitBinaryCandidates(null)).toEqual([
      "/usr/bin/git",
      "/opt/homebrew/bin/git",
      "/usr/local/bin/git",
      "git",
    ]);
  });
});

describe("selectUsableGitBinary", () => {
  it("returns the first candidate the probe accepts", () => {
    const selected = selectUsableGitBinary(
      ["/broken/git", "/xcode/git", "/homebrew/git"],
      (binary) => binary === "/xcode/git",
    );
    expect(selected).toBe("/xcode/git");
  });

  it("probes every candidate and returns null when all of them fail", () => {
    const probed: string[] = [];
    const selected = selectUsableGitBinary(["/a", "/b"], (binary) => {
      probed.push(binary);
      return false;
    });
    expect(selected).toBeNull();
    expect(probed).toEqual(["/a", "/b"]);
  });
});

describe("resolveGitBinary", () => {
  // The daemon's own environment is the failure mode: /usr/bin/git can be the
  // license-gated Xcode shim while every git-backed surface stays enabled, so the
  // resolved binary itself has to report a version instead of just resolving.
  it("resolves a binary that reports a git version", () => {
    const output = execFileSync(resolveGitBinary(), ["--version"], { encoding: "utf8" });
    expect(output).toMatch(/^git version\b/);
  });
});
