import {
  COLORTERM_VALUE,
  DEFAULT_MACOS_PTY_LOCALE,
  LOCALTERM_VALUE,
  PTY_ENV_DENYLIST,
  TERM_TYPE,
} from "./constants.js";
import type { SpawnPtyInput } from "./types.js";
import { shellPathForUserShell } from "./utils/shell-path.js";

interface BuildPtyEnvironmentOptions {
  input: SpawnPtyInput;
  sessionId: string;
  inheritedEnvironment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export const buildPtyEnvironment = ({
  input,
  sessionId,
  inheritedEnvironment = process.env,
  platform = process.platform,
}: BuildPtyEnvironmentOptions): Record<string, string> => {
  const environment: Record<string, string> = {};
  const deniedEnvironmentVariables = new Set(PTY_ENV_DENYLIST);
  const isLocaltermPath = (value: string) => /localterm-(?:zdot|bash)-/.test(value);
  // The daemon may inherit a stale ZDOTDIR / __LOCALTERM_ORIG_ZDOTDIR from
  // its login-shell wrapper — the previous session set ZDOTDIR to a temp
  // hook dir and the plist's `zsh -l -c` re-sources that hook .zshrc. Strip
  // any value that points to a localterm temp dir; pass through a legitimate
  // user-set ZDOTDIR (e.g. dotfiles managed via custom ZDOTDIR). ZDOTDIR
  // takes priority over __LOCALTERM_ORIG_ZDOTDIR because it reflects the
  // user's current environment.
  const inheritedZdotdir = inheritedEnvironment.ZDOTDIR;
  const inheritedOriginalZdotdir = inheritedEnvironment.__LOCALTERM_ORIG_ZDOTDIR;
  const userZdotdirFromEnvironment =
    inheritedZdotdir && !isLocaltermPath(inheritedZdotdir)
      ? inheritedZdotdir
      : inheritedOriginalZdotdir && !isLocaltermPath(inheritedOriginalZdotdir)
        ? inheritedOriginalZdotdir
        : undefined;
  for (const [key, value] of Object.entries(inheritedEnvironment)) {
    if (deniedEnvironmentVariables.has(key)) continue;
    if (typeof value === "string") environment[key] = value;
  }
  if (userZdotdirFromEnvironment) {
    environment.__LOCALTERM_ORIG_ZDOTDIR = userZdotdirFromEnvironment;
  } else {
    delete environment.__LOCALTERM_ORIG_ZDOTDIR;
  }
  // User shells bootstrap their own PATH via rc files; don't leak the daemon's.
  environment.PATH = shellPathForUserShell();
  if (input.env) {
    for (const [key, value] of Object.entries(input.env)) {
      environment[key] = value;
    }
  }
  const hasConfiguredLocale = Boolean(
    environment.LC_ALL || environment.LC_CTYPE || environment.LANG,
  );
  if (platform === "darwin" && !hasConfiguredLocale) {
    environment.LANG = DEFAULT_MACOS_PTY_LOCALE;
  }
  environment.TERM = TERM_TYPE;
  environment.COLORTERM = COLORTERM_VALUE;
  environment.LOCALTERM = LOCALTERM_VALUE;
  environment.LOCALTERM_SESSION_ID = sessionId;

  return environment;
};
