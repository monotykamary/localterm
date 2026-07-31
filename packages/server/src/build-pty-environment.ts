import os from "node:os";
import path from "node:path";
import {
  COLORTERM_VALUE,
  DEFAULT_MACOS_PTY_LOCALE,
  DEFAULT_TERMINAL_BROWSER_DISPLAY_SCALE,
  DEFAULT_TERMINAL_BROWSER_FRAME_BUDGET_MBPS,
  LOCALTERM_STATE_DIRNAME,
  LOCALTERM_VALUE,
  PTY_ENV_DENYLIST,
  TERM_TYPE,
  ZSH_HOOK_DIRNAME,
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
  // The daemon may inherit a stale ZDOTDIR / __LOCALTERM_ORIG_ZDOTDIR from
  // its login-shell wrapper — the previous session set ZDOTDIR to localterm's
  // zsh hook dir and the plist's `zsh -l -c` re-sources that hook .zshrc.
  // Strip any value that points at a localterm-owned hook path (the stable
  // per-user dir, or a legacy per-session temp dir): treating the hook dir as
  // a user ZDOTDIR would make the generated hook source itself. Pass through
  // a legitimate user-set ZDOTDIR (e.g. dotfiles managed via custom ZDOTDIR).
  // ZDOTDIR takes priority over __LOCALTERM_ORIG_ZDOTDIR because it reflects
  // the user's current environment.
  const stableZshHookDir = path.join(os.homedir(), LOCALTERM_STATE_DIRNAME, ZSH_HOOK_DIRNAME);
  const isLocaltermPath = (value: string) =>
    /localterm-(?:zdot|bash)-/.test(value) || value === stableZshHookDir;
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
  // terminal-browser otherwise treats xterm's CSS pixels as Retina device pixels,
  // and its conservative inline transport cap leaves LocalTerm's backpressured path idle.
  environment.TERMINAL_BROWSER_DISPLAY_SCALE ||= String(
    DEFAULT_TERMINAL_BROWSER_DISPLAY_SCALE,
  );
  environment.TERMINAL_BROWSER_FRAME_BUDGET_MBPS ||= String(
    DEFAULT_TERMINAL_BROWSER_FRAME_BUDGET_MBPS,
  );

  return environment;
};
