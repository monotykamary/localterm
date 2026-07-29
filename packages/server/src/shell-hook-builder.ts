import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LOCALTERM_STATE_DIRNAME,
  SECRETS_SHIMS_DIRNAME,
  ZSH_EXEC_SHADOW_MAX_DEPTH,
  ZSH_HOOK_DIRNAME,
} from "./constants.js";
import { shimPathPrependLine } from "./secret-shims.js";

interface ShellHookBuilderOptions {
  shimsDir: string | undefined;
  reportInitialCommandExit: boolean;
  homeDir?: string;
}

export class ShellHookBuilder {
  readonly hookCleanupPaths: string[] = [];
  private readonly shimsDir: string | undefined;
  private readonly reportInitialCommandExit: boolean;
  private readonly homeDir: string;

  constructor({ shimsDir, reportInitialCommandExit, homeDir }: ShellHookBuilderOptions) {
    this.shimsDir = shimsDir;
    this.reportInitialCommandExit = reportInitialCommandExit;
    this.homeDir = homeDir ?? os.homedir();
  }

  prepare(
    shellName: string,
    env: Record<string, string>,
  ): [string[], Record<string, string> | null] {
    const hookId = `${process.pid}-${Date.now()}`;
    switch (shellName) {
      case "zsh": {
        // Stable per-user dir, deliberately NOT registered in hookCleanupPaths:
        // exec'd wrapper shells (iris from the user's rc, tmux panes) re-source
        // it via the inherited ZDOTDIR after this session is gone — see
        // ZSH_HOOK_DIRNAME in constants.ts.
        const hookDir = path.join(this.homeDir, LOCALTERM_STATE_DIRNAME, ZSH_HOOK_DIRNAME);
        mkdirSync(hookDir, { recursive: true, mode: 0o700 });
        const hookScript = this.zshOsc7ChpwdFunction();
        const userZdotdir = env.__LOCALTERM_ORIG_ZDOTDIR || env.ZDOTDIR || this.homeDir;
        const shimsPrepend = shimPathPrependLine(this.shimsDirectory());
        const escapedZdotdir = userZdotdir.replace(/'/g, "'\\''");
        const lines = [
          // Same-process re-entry guard: a user rc that sources
          // $ZDOTDIR/.zshrc, or a misconfigured env pointing ZDOTDIR back at
          // this hook dir, must not replay the hook recursively. Shell-local
          // (not exported), so replayed shells — fresh processes like an
          // exec'd wrapper's children — still run the full hook.
          '[[ -n "${__LOCALTERM_HOOK_SOURCED:-}" ]] && return 0',
          "__LOCALTERM_HOOK_SOURCED=1",
          `source '${escapedZdotdir}/.zshenv' 2>/dev/null`,
          '__localterm_hook_zdotdir="${ZDOTDIR}"',
          ...this.zshExecShadowLines(),
          `ZDOTDIR='${escapedZdotdir}'`,
          // Source the zsh login file before .zshrc (matching `zsh -l`'s
          // .zshenv → .zprofile → .zshrc order) so PATH/env a user set in
          // .zprofile is visible in the interactive session. zsh users keep
          // interactive setup in .zshrc, so cross-sourcing is rare here and a
          // double-source risk is low (unlike bash's .profile→.bashrc).
          `source '${escapedZdotdir}/.zprofile' 2>/dev/null`,
          `source '${escapedZdotdir}/.zshrc' 2>/dev/null`,
          'ZDOTDIR="${__localterm_hook_zdotdir}"',
          "unfunction exec 2>/dev/null || true",
          // Prepend the secrets shims dir AFTER the user's .zshrc ran, so the
          // shims reliably shadow the real binaries despite rc PATH
          // manipulation (e.g. `export PATH=/opt/homebrew/bin:$PATH`). The line
          // is a no-op when the shims dir is absent (feature not configured).
          shimsPrepend,
          // zsh's PROMPT_SP (on by default) prints the EOL mark (bold+reverse %
          // by default — the "white-background %") AND a fill-to-end-of-line
          // space burst before each prompt when the prior line had no trailing
          // newline. localterm's precmd/chpwd hooks emit OSC sequences with no
          // newline, so PROMPT_SP fires on every prompt and zle's redraw
          // normally erases both. localterm resizes xterm before the server's
          // PTY catches up (async over a high-latency relay), so during a shell
          // redraw — and especially at spawn, where the PTY starts at the wide
          // DEFAULT_COLS while the mobile xterm is still its narrow viewport —
          // the mark and the fill spaces (sized for the wider PTY) wrap in the
          // narrower xterm and zle's clear-to-end-of-screen erases from the
          // wrapped line, leaving the mark as a stray `%` and the spaces as a
          // blank line above the prompt. Emptying PROMPT_EOL_MARK only kills the
          // visible mark; the fill spaces still wrap. Disabling PROMPT_SP kills
          // both. The cost is the standard non-zsh behavior: a command whose
          // output lacks a trailing newline gets the prompt on the same line
          // instead of a fresh one — fine here, since the only unterminated
          // output in this setup is localterm's own OSC hooks (invisible).
          "unsetopt PROMPT_SP",
          hookScript,
          "chpwd_functions=(${chpwd_functions[@]} __localterm_osc7_chpwd)",
          "__localterm_osc7_chpwd",
          "__localterm_git_dirty() { printf '\\e]7777;git-dirty\\a'; }",
          "precmd_functions=(${precmd_functions[@]} __localterm_git_dirty)",
          "__localterm_fg_preexec() { printf '\\e]7777;fg;%s\\a' \"${1%% *}\"; }",
          "preexec_functions=(${preexec_functions[@]} __localterm_fg_preexec)",
          "__localterm_fg_precmd() { printf '\\e]7777;fg-idle\\a'; }",
          "precmd_functions=(__localterm_fg_precmd ${precmd_functions[@]})",
          // Installed unconditionally: this rc file is session-independent
          // now, so the per-session gate is the LOCALTERM_INITIAL_COMMAND env
          // var the function checks at runtime (a no-op for normal shells).
          ...this.automationExitHookFunctionLines("__localterm_automation_exit_precmd"),
          "precmd_functions=(__localterm_automation_exit_precmd ${precmd_functions[@]})",
        ];
        writeFileSync(path.join(hookDir, ".zshrc"), lines.join("\n") + "\n", {
          mode: 0o600,
        });
        return [[], { ZDOTDIR: hookDir, __LOCALTERM_ORIG_ZDOTDIR: userZdotdir }];
      }
      case "bash": {
        const hookDir = path.join(os.tmpdir(), `localterm-bash-${hookId}`);
        mkdirSync(hookDir, { recursive: true, mode: 0o700 });
        const hookPath = path.join(hookDir, "bashrc");
        this.hookCleanupPaths.push(hookDir);
        const hookScript = this.bashOsc7Function();
        const shimsPrepend = shimPathPrependLine(this.shimsDirectory());
        const lines = [
          // Login-shell env (mimic `bash -l`): /etc/profile then the first
          // existing login file. ~/.bashrc is sourced only when NO login file
          // exists, so a login file that already sources .bashrc (the common
          // Ubuntu .profile pattern: `if [ -n "$BASH_VERSION" ]; then . ~/.bashrc; fi`)
          // doesn't get .bashrc twice — which would duplicate PATH prepends
          // (Ubuntu's .profile adds $HOME/.local/bin and .bashrc adds $HOME/bin).
          // The system interactive files /etc/bashrc + /etc/bash.bashrc stay
          // (the original behavior) so macOS's /etc/bashrc prompt setup and
          // Debian's /etc/bash.bashrc are preserved even with a login file.
          "source /etc/profile 2>/dev/null",
          "__localterm_login_loaded=0",
          'for __localterm_f in ~/.bash_profile ~/.bash_login ~/.profile; do [ -f "$__localterm_f" ] && . "$__localterm_f" && __localterm_login_loaded=1 && break; done',
          "source /etc/bashrc 2>/dev/null",
          "source /etc/bash.bashrc 2>/dev/null",
          '[ "$__localterm_login_loaded" != 1 ] && source ~/.bashrc 2>/dev/null',
          // Prepend the secrets shims dir AFTER the user's rc ran (see the
          // zsh case for why the ordering matters).
          shimsPrepend,
          hookScript,
          'PROMPT_COMMAND="__localterm_prompt_start;${PROMPT_COMMAND:+${PROMPT_COMMAND};}__localterm_osc7_prompt;__localterm_git_dirty;__localterm_fg_precmd"',
          "__localterm_osc7_prompt",
          "__localterm_git_dirty() { printf '\\e]7777;git-dirty\\a'; }",
          "__localterm_fg_precmd() { printf '\\e]7777;fg-idle\\a'; __localterm_in_prompt=0; }",
          "__localterm_prompt_start() { __localterm_in_prompt=1; }",
          "__localterm_in_prompt=0",
          '__localterm_fg_debug() { [ "$__localterm_in_prompt" = 1 ] && return; case "$BASH_COMMAND" in __localterm_*) return ;; esac; printf \'\\e]7777;fg;%s\\a\' "${BASH_COMMAND%% *}"; }',
          "__localterm_prev_debug_body=",
          '__localterm_capture_debug() { local __t; __t=$(trap -p DEBUG); [ -z "$__t" ] && return; __t=${__t#trap -- }; __t=${__t% DEBUG}; __localterm_prev_debug_body=$__t; }',
          "__localterm_capture_debug",
          'if [ -n "$__localterm_prev_debug_body" ]; then trap \'__localterm_fg_debug; eval "$__localterm_prev_debug_body"\' DEBUG; else trap __localterm_fg_debug DEBUG; fi',
          ...(this.reportInitialCommandExit
            ? [
                ...this.automationExitHookFunctionLines("__localterm_automation_exit_prompt"),
                'PROMPT_COMMAND="__localterm_automation_exit_prompt${PROMPT_COMMAND:+;${PROMPT_COMMAND}}"',
              ]
            : []),
        ];
        writeFileSync(hookPath, lines.join("\n") + "\n", { mode: 0o600 });
        return [["--rcfile", hookPath], null];
      }
      case "fish": {
        // fish's `-C` / `--init-command` runs AFTER ~/.config/fish/config.fish
        // and the conf.d snippets load, so the user's config (including
        // conf.d PATH manipulation) runs first and the shims prepend below
        // shadows it — see the zsh case for why the ordering matters. Unlike
        // zsh/bash this needs no temp rcfile: -C injects the setup directly
        // and the event-bound functions persist for the session.
        const shimsDir = this.shimsDirectory();
        // fish escapes a single quote inside single quotes as `\'` (not the
        // `\''` POSIX idiom).
        const escapedShimsDir = shimsDir.replace(/'/g, "\\'");
        const shimsPrepend = `test -d '${escapedShimsDir}' && set -gx PATH '${escapedShimsDir}' $PATH`;
        // The fish_prompt handler emits the git-dirty signal, and (when an
        // initial command is staged) copies LOCALTERM_INITIAL_COMMAND into a
        // local, clears the env var, evals the local, and emits the
        // automation-exit OSC with the eval's $status. See
        // automationExitHookFunctionLines for the security rationale (copy +
        // unset before eval, PTY_ENV_DENYLIST) and why this runs the command
        // instead of typing it into the PTY.
        const lines = [
          "function __localterm_osc7 --on-variable PWD",
          "    printf '\\e]7;file://%s%s\\a' (hostname 2>/dev/null || echo localhost) $PWD",
          "end",
          "__localterm_osc7",
          shimsPrepend,
          "function __localterm_fg_preexec --on-event fish_preexec",
          "    printf '\\e]7777;fg;%s\\a' (string split ' ' -- $argv[1])[1]",
          "end",
          "function __localterm_prompt_hook --on-event fish_prompt",
          "    printf '\\e]7777;git-dirty\\a'",
          ...(this.reportInitialCommandExit
            ? [
                '    if test -n "$LOCALTERM_INITIAL_COMMAND"',
                "        set -l __localterm_initial_command $LOCALTERM_INITIAL_COMMAND",
                "        set -e LOCALTERM_INITIAL_COMMAND",
                "        printf '+ %s\\n' $__localterm_initial_command",
                "        printf '\\e]7777;fg;%s\\a' (string split ' ' -- $__localterm_initial_command)[1]",
                "        eval $__localterm_initial_command",
                "        printf '\\e]7777;automation-exit;%d\\a' $status",
                "    end",
              ]
            : []),
          "    printf '\\e]7777;fg-idle\\a'",
          "end",
        ];
        return [["-C", lines.join("\n")], null];
      }
      default:
        return [[], null];
    }
  }

  // The initial command for a hooked shell (zsh/bash/fish) is run by this hook
  // via `eval`, instead of being typed into the PTY — so it never goes through
  // the line editor's typed-input path and can't race ECHO or double-echo. The
  // command arrives through the LOCALTERM_INITIAL_COMMAND env var (set in the
  // constructor). The hook copies it into a local and unsets the env var
  // BEFORE eval, so the command string isn't inherited by child processes the
  // command spawns and the hook runs once; then prints it (prefixed `+`),
  // emits a git-dirty signal before the eval so the ambient overlay updates
  // as the command begins (the regular __localterm_git_dirty runs after this
  // hook in the prompt chain — without this the first git-dirty only fires
  // once the command finishes), evals the local, and emits the
  // automation-exit OSC with the eval's exit status. Prepended first in the
  // prompt chain; unhooked shells don't reach here (they take the at-spawn
  // PTY write).
  // LOCALTERM_INITIAL_COMMAND is on PTY_ENV_DENYLIST so a stale or inherited
  // value from the daemon env can't reach the hook — the constructor's set is
  // the only source.
  private automationExitHookFunctionLines(functionName: string): string[] {
    return [
      `${functionName}() {`,
      '  if [ -n "${LOCALTERM_INITIAL_COMMAND:-}" ]; then',
      "    local __localterm_command_exit __localterm_initial_command",
      '    __localterm_initial_command="$LOCALTERM_INITIAL_COMMAND"',
      "    unset LOCALTERM_INITIAL_COMMAND",
      "    printf '+ %s\\n' \"$__localterm_initial_command\"",
      "    printf '\\e]7777;git-dirty\\a'",
      "    printf '\\e]7777;fg;%s\\a' \"${__localterm_initial_command%% *}\"",
      '    eval "$__localterm_initial_command"',
      "    __localterm_command_exit=$?",
      "    printf '\\e]7777;automation-exit;%d\\a' \"$__localterm_command_exit\"",
      "  fi",
      "}",
    ];
  }

  // zsh resolves functions before builtins, so this shadows `exec` for the
  // duration of the user's rc files (unfunctioned once they return). The hook
  // flips ZDOTDIR to the user's real zdotdir while sourcing rc files; without
  // intervention an rc-level `exec` of a shell wrapper (iris's `exec iris`,
  // an auto-attach `exec tmux`, …) hands that REAL zdotdir to the wrapper's
  // respawned child shells — this hook never replays in them, and the shell
  // the user actually types into loses the secrets-shim PATH prepend, osc7
  // cwd tracking, and the fg/git signals. For real command-execs the shadow
  // re-pins ZDOTDIR to this hook dir and bumps an exported depth counter: the
  // wrapper's child shells inherit both and replay this hook inside the
  // wrapper. Guarded wrappers (IRIS_PID, $TMUX) stop re-exec'ing there; past
  // ZSH_EXEC_SHADOW_MAX_DEPTH the shadow refuses, so an unguarded wrapper
  // can't spin an exec loop forever. Redirection-only (`exec 3>&1`) and flag
  // forms (-a/-c/-l) delegate untouched — best effort, since function-scoped
  // redirections can't be rebound from here. exec'd children of the
  // interactive shell need no pinning either: by then ZDOTDIR already holds
  // the hook dir. The function-local `typeset -x` assignments are exactly
  // right here: zsh reverts them when the function returns (exec failure), but
  // a successful exec replaces the process first, so the pinned values are
  // what the wrapper child inherits.
  private zshExecShadowLines(): string[] {
    return [
      "exec() {",
      '  if (( $# == 0 )) || [[ "$1" == -* ]]; then builtin exec "$@"; return; fi',
      "  local __localterm_exec_depth=$(( ${__LOCALTERM_EXEC_DEPTH:-0} + 1 ))",
      `  if (( __localterm_exec_depth > ${ZSH_EXEC_SHADOW_MAX_DEPTH} )); then`,
      // Explicit 2>/dev/tty: the hook sources user rc with 2>/dev/null, so a
      // plain print -u2 would be swallowed — the warning must reach the user.
      '    print -u2 "localterm: refusing rc exec of "$1": wrapper re-exec depth exceeds the safety limit (rc exec wrappers must guard re-entry with an env marker)" 2>/dev/tty',
      "    return 1",
      "  fi",
      "  typeset -x __LOCALTERM_EXEC_DEPTH=$__localterm_exec_depth",
      '  typeset -x ZDOTDIR="$__localterm_hook_zdotdir"',
      '  builtin exec "$@"',
      "}",
    ];
  }

  private shimsDirectory(): string {
    return this.shimsDir ?? path.join(this.homeDir, LOCALTERM_STATE_DIRNAME, SECRETS_SHIMS_DIRNAME);
  }

  private zshOsc7ChpwdFunction(): string {
    return [
      "__localterm_osc7_chpwd() {",
      '  printf \'\\e]7;file://%s%s\\a\' "${HOSTNAME:-localhost}" "${PWD}"',
      "}",
    ].join("\n");
  }

  private bashOsc7Function(): string {
    return [
      "__localterm_osc7_prompt() {",
      '  printf \'\\e]7;file://%s%s\\a\' "${HOSTNAME:-localhost}" "${PWD}"',
      "}",
    ].join("\n");
  }
}
