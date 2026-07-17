import {
  COLORTERM_VALUE,
  LOCALTERM_VALUE,
  PTY_ENV_DENYLIST,
  TERM_TYPE,
} from "./constants.js";
import type { SpawnPtyInput } from "./types.js";
import { shellPathForUserShell } from "./utils/shell-path.js";

interface BuildPtyEnvironmentOptions {
  input: SpawnPtyInput;
  sessionId: string;
}

export const buildPtyEnvironment = ({
  input,
  sessionId,
}: BuildPtyEnvironmentOptions): Record<string, string> => {
  const env: Record<string, string> = {};
  const denied = new Set(PTY_ENV_DENYLIST);
  const isLocaltermPath = (value: string) => /localterm-(?:zdot|bash)-/.test(value);
  // The daemon may inherit a stale ZDOTDIR / __LOCALTERM_ORIG_ZDOTDIR from
  // its login-shell wrapper — the previous session set ZDOTDIR to a temp
  // hook dir and the plist's `zsh -l -c` re-sources that hook .zshrc. Strip
  // any value that points to a localterm temp dir; pass through a legitimate
  // user-set ZDOTDIR (e.g. dotfiles managed via custom ZDOTDIR). ZDOTDIR
  // takes priority over __LOCALTERM_ORIG_ZDOTDIR because it reflects the
  // user's current environment.
  const inheritedZdotdir = process.env.ZDOTDIR;
  const inheritedOrigZdotdir = process.env.__LOCALTERM_ORIG_ZDOTDIR;
  const userZdotdirFromEnv =
    inheritedZdotdir && !isLocaltermPath(inheritedZdotdir)
      ? inheritedZdotdir
      : inheritedOrigZdotdir && !isLocaltermPath(inheritedOrigZdotdir)
        ? inheritedOrigZdotdir
        : undefined;
  for (const [key, value] of Object.entries(process.env)) {
    if (denied.has(key)) continue;
    if (typeof value === "string") env[key] = value;
  }
  if (userZdotdirFromEnv) env.__LOCALTERM_ORIG_ZDOTDIR = userZdotdirFromEnv;
  else delete env.__LOCALTERM_ORIG_ZDOTDIR;
  // User shells bootstrap their own PATH via rc files; don't leak the daemon's.
  env.PATH = shellPathForUserShell();
  if (input.env) {
    for (const [key, value] of Object.entries(input.env)) {
      env[key] = value;
    }
  }
  env.TERM = TERM_TYPE;
  env.COLORTERM = COLORTERM_VALUE;
  env.LOCALTERM = LOCALTERM_VALUE;
  env.LOCALTERM_SESSION_ID = sessionId;

  return env;
};
