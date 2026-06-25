import { execFileSync } from "node:child_process";

let resolved: string | undefined;

// The daemon is a launchd agent with no GUI provenance, so syspolicyd re-assesses
// ad-hoc/Developer-ID binaries on every spawn — homebrew `git` is ad-hoc, and the
// daemon runs `git` (diff summaries, repo detection) on every PTY open, which is
// the syspolicyd spike. `/usr/bin/git` is Apple-signed (cached regardless of
// provenance) and, with Xcode CLI tools installed, a real git — so prefer it.
// Where `/usr/bin/git` is only the Xcode shim, fall back to PATH-resolved `git`.
export const resolveGitBinary = (): string => {
  if (resolved !== undefined) return resolved;
  try {
    const out = execFileSync("/usr/bin/git", ["--version"], {
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8");
    resolved = /^git version\b/.test(out.trim()) ? "/usr/bin/git" : "git";
  } catch {
    resolved = "git";
  }
  return resolved;
};
