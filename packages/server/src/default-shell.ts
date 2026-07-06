import { accessSync, constants as fsConstants } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import { DEFAULT_SHELL_FALLBACK } from "./constants.js";

const isExecutable = (binaryPath: string): boolean => {
  try {
    accessSync(binaryPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const getDefaultShell = (): string => {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "cmd.exe";
  }
  // Priority order (matches VS Code, Hyper, and Warp):
  //   1. LOCALTERM_SHELL — explicit user override
  //   2. os.userInfo().shell — the user's persistent login shell from passwd / DSCL
  //   3. process.env.SHELL — only as a fallback; this leaks the parent process's
  //      shell (often zsh from launchd / a Cursor terminal) and is wrong when the
  //      user has changed their default with `chsh`
  //   4. DEFAULT_SHELL_FALLBACK
  const candidates: string[] = [];
  if (process.env.LOCALTERM_SHELL) candidates.push(process.env.LOCALTERM_SHELL);
  try {
    const userInfo = os.userInfo();
    if (userInfo.shell) candidates.push(userInfo.shell);
  } catch {
    /* os.userInfo throws on systems without /etc/passwd entry for the uid */
  }
  if (process.env.SHELL) candidates.push(process.env.SHELL);
  candidates.push(DEFAULT_SHELL_FALLBACK);
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }
  return DEFAULT_SHELL_FALLBACK;
};

// Validate a caller-provided shell override (the WS `?shell=` query param or the
// REST `shell` field). Returns the path only when it points to an executable
// binary, so a stale/garbage value degrades to the detected default instead of
// spawning a non-existent shell. The WS path silently falls back; the REST
// handlers treat "provided but not executable" as a 400 so an agent gets
// feedback instead of a silently-different shell.
export const resolveShellOverride = (shell: string | undefined | null): string | undefined => {
  if (!shell) return undefined;
  const trimmed = shell.trim();
  if (!trimmed) return undefined;
  return isExecutable(trimmed) ? trimmed : undefined;
};

// Reads `/etc/shells` (the Unix registry of approved login shells that `chsh`
// enforces) and returns the executable entries, de-duplicated with the detected
// default shell first. On non-Unix hosts (or where `/etc/shells` is absent) the
// list is just the detected default. Surfaced via `GET /api/config` so the
// Settings shell field and `localterm session new --help` can show what the
// host actually offers instead of a free-text guess.
const readEtcShells = (): string[] => {
  if (process.platform === "win32") return [];
  try {
    const contents = readFileSync("/etc/shells", "utf8");
    const paths: string[] = [];
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (isExecutable(trimmed)) paths.push(trimmed);
    }
    return paths;
  } catch {
    return [];
  }
};

export const listKnownShells = (): string[] => {
  const defaultShell = getDefaultShell();
  const seen = new Set<string>([defaultShell]);
  const ordered = [defaultShell];
  for (const shell of readEtcShells()) {
    if (!seen.has(shell)) {
      seen.add(shell);
      ordered.push(shell);
    }
  }
  return ordered;
};
