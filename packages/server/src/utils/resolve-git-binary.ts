import { execFileSync } from "node:child_process";
import path from "node:path";

let resolved: string | undefined;

const GIT_VERSION_OUTPUT = /^git version\b/;

const execVersion = (binary: string, args: string[]): string => {
  return execFileSync(binary, args, {
    timeout: 5_000,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString("utf8")
    .trim();
};

// The daemon is a launchd agent with no GUI provenance, so syspolicyd re-assesses
// ad-hoc/Developer-ID binaries on every spawn — homebrew `git` is ad-hoc, and the
// daemon runs `git` (diff summaries, repo detection) on every PTY open, which is
// the syspolicyd spike. `/usr/bin/git` is Apple-signed (cached regardless of
// provenance) and, with Xcode CLI tools installed, a real git — so prefer it.
//
// It is not always usable, though: when it is only the Xcode shim, it refuses to
// run until the Xcode license is accepted (exit 69), and the daemon cannot fall
// back to PATH — its baked PATH is /usr/bin:/bin:/usr/sbin:/sbin, so a PATH
// lookup lands back on that same shim. That silently disabled every git-backed
// surface (diff summary, branch/PR metadata, worktrees) while the user's own
// shell — whose rc files put homebrew first — still worked. Probe the developer
// dir's own git binary next: the license gate lives in the /usr/bin and xcrun
// entry points, so the binary behind them reports a version regardless. Homebrew
// prefixes follow for machines without Xcode, and the bare name stays last so a
// PATH-only install still works.
export const gitBinaryCandidates = (developerDir: string | null): string[] => {
  const candidates = ["/usr/bin/git"];
  if (developerDir !== null) candidates.push(path.join(developerDir, "usr", "bin", "git"));
  candidates.push("/opt/homebrew/bin/git", "/usr/local/bin/git", "git");
  return candidates;
};

export const selectUsableGitBinary = (
  candidates: readonly string[],
  isUsable: (binary: string) => boolean,
): string | null => {
  for (const candidate of candidates) {
    if (isUsable(candidate)) return candidate;
  }
  return null;
};

const readXcodeDeveloperDir = (): string | null => {
  if (process.platform !== "darwin") return null;
  try {
    const developerDir = execVersion("/usr/bin/xcode-select", ["-p"]);
    return path.isAbsolute(developerDir) ? developerDir : null;
  } catch {
    /* no active developer dir — Xcode and the CLI tools are both absent */
    return null;
  }
};

const isUsableGit = (binary: string): boolean => {
  try {
    return GIT_VERSION_OUTPUT.test(execVersion(binary, ["--version"]));
  } catch {
    /* missing, unreadable, license-gated, or not actually git */
    return false;
  }
};

export const resolveGitBinary = (): string => {
  if (resolved !== undefined) return resolved;
  resolved =
    selectUsableGitBinary(gitBinaryCandidates(readXcodeDeveloperDir()), isUsableGit) ?? "git";
  return resolved;
};
