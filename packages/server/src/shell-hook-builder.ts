import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCALTERM_STATE_DIRNAME, SECRETS_SHIMS_DIRNAME } from "./constants.js";
import { shimPathPrependLine } from "./secret-shims.js";

interface ShellHookBuilderOptions {
  shimsDir: string | undefined;
  reportInitialCommandExit: boolean;
}

export class ShellHookBuilder {
  readonly hookCleanupPaths: string[] = [];
  private readonly shimsDir: string | undefined;
  private readonly reportInitialCommandExit: boolean;

  constructor({ shimsDir, reportInitialCommandExit }: ShellHookBuilderOptions) {
    this.shimsDir = shimsDir;
    this.reportInitialCommandExit = reportInitialCommandExit;
  }

  prepare(
    shellName: string,
    env: Record<string, string>,
  ): [string[], Record<string, string> | null] {
    const hookId = `${process.pid}-${Date.now()}`;
    switch (shellName) {
      case "zsh": {
        const hookDir = path.join(os.tmpdir(), `localterm-zdot-${hookId}`);
        mkdirSync(hookDir, { recursive: true, mode: 0o700 });
        this.hookCleanupPaths.push(hookDir);
        const hookScript = this.zshOsc7ChpwdFunction();
        const userZdotdir = env.__LOCALTERM_ORIG_ZDOTDIR || env.ZDOTDIR || os.homedir();
        const shimsPrepend = shimPathPrependLine(
          this.shimsDir ?? path.join(os.homedir(), LOCALTERM_STATE_DIRNAME, SECRETS_SHIMS_DIRNAME),
        );
        const escapedZdotdir = userZdotdir.replace(/'/g, "'\\''");
        const lines = [
          `source '${escapedZdotdir}/.zshenv' 2>/dev/null`,
          '__localterm_saved_zdotdir="${ZDOTDIR}"',
          `ZDOTDIR='${escapedZdotdir}'`,
          // Source the zsh login file before .zshrc (matching `zsh -l`'s
          // .zshenv → .zprofile → .zshrc order) so PATH/env a user set in
          // .zprofile is visible in the interactive session. zsh users keep
          // interactive setup in .zshrc, so cross-sourcing is rare here and a
          // double-source risk is low (unlike bash's .profile→.bashrc).
          `source '${escapedZdotdir}/.zprofile' 2>/dev/null`,
          `source '${escapedZdotdir}/.zshrc' 2>/dev/null`,
          'ZDOTDIR="${__localterm_saved_zdotdir}"',
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
          ...(this.reportInitialCommandExit
            ? [
                ...this.automationExitHookFunctionLines("__localterm_automation_exit_precmd"),
                "precmd_functions=(__localterm_automation_exit_precmd ${precmd_functions[@]})",
              ]
            : []),
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
        const shimsPrepend = shimPathPrependLine(
          this.shimsDir ?? path.join(os.homedir(), LOCALTERM_STATE_DIRNAME, SECRETS_SHIMS_DIRNAME),
        );
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
        const shimsDir =
          this.shimsDir ?? path.join(os.homedir(), LOCALTERM_STATE_DIRNAME, SECRETS_SHIMS_DIRNAME);
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
