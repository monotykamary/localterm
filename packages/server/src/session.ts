import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import {
  COLORTERM_VALUE,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  LOCALTERM_STATE_DIRNAME,
  LOCALTERM_VALUE,
  MAX_NOTIFICATION_LENGTH,
  MAX_PENDING_PARSE_BYTES,
  PTY_ENV_DENYLIST,
  SECRETS_SHIMS_DIRNAME,
  SESSION_SCROLLBACK_REPLAY_BYTES,
  TERM_TYPE,
} from "./constants.js";
// Titles are emitted on a dedicated `title` event so they travel as a separate
// WebSocket frame. We deliberately do NOT splice OSC sequences into the PTY
// output stream — doing so corrupts in-flight escape sequences from modern
// TUIs (e.g. Cursor Agent / Claude Code use DECSET 2026 synchronized output
// mode and any byte landing inside that frame breaks the parser state).
import { ensureSpawnHelperExecutable } from "./ensure-spawn-helper-executable.js";
import { ForegroundWatcher } from "./foreground-watcher.js";
import { getDefaultShell } from "./default-shell.js";
import { shimPathPrependLine } from "./secret-shims.js";
import { shellPathForUserShell } from "./utils/shell-path.js";
import type { SpawnPtyInput } from "./types.js";
import { formatWorkingDirectoryTitle } from "./utils/format-working-directory-title.js";
import { parseAltScreenFromChunk } from "./utils/parse-alt-screen.js";
import { parseOsc7FromChunk } from "./utils/parse-osc7.js";
import { parseOscAutomationExitFromChunk } from "./utils/parse-osc-automation-exit.js";
import { parseOscDirtyFromChunk } from "./utils/parse-osc-dirty.js";
import { parseOscNotificationsFromChunk } from "./utils/parse-osc-notification.js";
import { parseOscTitleFromChunk } from "./utils/parse-osc-title.js";
import { confirmShellProcessName } from "./utils/shell-process-name.js";
import { TerminalModeState } from "./utils/terminal-mode-state.js";
import { terminalQueryResponder } from "./utils/terminal-query-responder.js";

interface SessionEvents {
  output: [data: string];
  exit: [code: number | null];
  title: [title: string];
  cwd: [cwd: string];
  foreground: [process: string | null];
  notification: [body: string];
  "git-dirty": [];
  "automation-exit": [code: number];
}

export class Session extends EventEmitter<SessionEvents> {
  readonly shell: string;
  readonly cwd: string;
  readonly createdAt: number;
  readonly id: string;
  private readonly shimsDir: string | undefined;

  private readonly pty: IPty;
  private readonly shellName: string;
  // Process names pty.process reports for the shell itself: the invoked
  // basename and full path, plus the shell's alias name on macOS where they
  // differ. On macOS node-pty reads kp_proc.p_comm, which an aliased shell
  // overrides: /bin/sh is bash, so an idle /bin/sh reports "bash" — not the
  // invoked basename "sh" — forever, which the original basename-only check
  // misread as a running foreground program. The alias name is learned from
  // the pty.process reading the first time the terminal's foreground group id
  // (tpgid) confirms the shell is idle (see inferForegroundProcess), so it
  // never absorbs a genuine program and never races a user-typed command.
  private readonly shellProcessNames = new Set<string>();
  private currentCols: number;
  private currentRows: number;
  private exited = false;
  private paused = false;
  private initialTitle = "";
  private lastEmittedTitle = "";
  private lastEmittedCwdValue = "";
  private lastEmittedForegroundValue: string | null | undefined = undefined;
  private pixelResizeSupported: boolean | null = null;
  private hookCleanupPaths: string[] = [];
  private pendingParse = "";
  // Scrollback ring buffer for attach-time replay. Appended on every PTY data
  // event regardless of attached clients so a tab switching to this session
  // lands on recent output instead of a blank screen. Bounded by byte cap;
  // oldest chunks are dropped as new output arrives.
  private readonly scrollbackChunks: string[] = [];
  private scrollbackBytes = 0;
  // Live DECSET/DECRST mode state (alt-screen, mouse, bracketed paste, cursor
  // hide) updated from every PTY chunk. snapshotScrollback() prepends a
  // restore prefix from this so a switch into a long-running TUI re-enters the
  // alt screen and re-enables mouse even when the TUI's mode-set sequences
  // have scrolled out of the 256KB replay window — otherwise the wheel scrolls
  // xterm's scrollback instead of the TUI.
  private readonly modeState = new TerminalModeState();
  private readonly foregroundWatcher: ForegroundWatcher;
  private readonly reportInitialCommandExit: boolean;
  private hasEmittedAutomationExit = false;

  // Whether the PTY's foreground app enabled a mouse tracking mode (1000–1007).
  // Gates the SGR-1006 fallback for `session mouse` when no CDP tab is
  // available: writing mouse bytes into a session that didn't enable mouse
  // would feed them to the app as typed text. xterm.js gates this itself when
  // dispatching a real event over CDP.
  get mouseEnabled(): boolean {
    return this.modeState.mouseEnabled;
  }

  constructor(input: SpawnPtyInput) {
    super();
    ensureSpawnHelperExecutable();
    this.shell = input.shell ?? getDefaultShell();
    this.shellName = path.basename(this.shell);
    this.shellProcessNames.add(this.shellName);
    this.shellProcessNames.add(this.shell);
    this.cwd = input.cwd ?? os.homedir();
    this.currentCols = input.cols ?? DEFAULT_COLS;
    this.currentRows = input.rows ?? DEFAULT_ROWS;
    this.createdAt = Date.now();
    this.id = randomUUID();
    this.reportInitialCommandExit = Boolean(input.initialCommand);
    this.shimsDir = input.shimsDir;

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

    const [shellArgs, shellEnv] = this.prepareOsc7Hook(this.shellName, env);
    if (shellEnv) {
      for (const [key, value] of Object.entries(shellEnv)) {
        env[key] = value;
      }
    }

    this.pty = spawn(this.shell, shellArgs, {
      name: TERM_TYPE,
      cols: this.currentCols,
      rows: this.currentRows,
      cwd: this.cwd,
      env,
    });

    this.pty.onData((data) => {
      // Intercept DA1/DA2 identity queries: answer them from the cached xterm
      // response instantly (in-process, no round-trip to xterm) and remove the
      // request from the output so xterm never sees it and never responds.
      // Without this the remote round-trip loses the race against a short read
      // timeout or a process exit, orphaning the response in the PTY stdin as
      // typed text (e.g. `62;4;9;22c`). Cold cache: the request round-trips to
      // xterm as today and the response is captured in write(). The cleaned
      // output (request removed) is what clients and the scrollback see, so the
      // replay never carries a stale DA request either.
      const { passthrough, responses } = terminalQueryResponder.interceptRequest(data);
      for (const response of responses) this.pty.write(response);
      this.onPtyOutput(passthrough);
      this.appendScrollback(passthrough);
      this.emit("output", passthrough);
    });

    this.pty.onExit(({ exitCode }) => {
      this.exited = true;
      this.emit("exit", exitCode);
    });

    // The PTY line discipline buffers the bytes until the shell reads stdin,
    // so writing before the first prompt is safe — the command echoes at the
    // prompt and runs exactly as if the user had typed it.
    if (input.initialCommand) this.pty.write(`${input.initialCommand}\r`);

    this.emitInitialMetadata();
    this.foregroundWatcher = new ForegroundWatcher(
      () => this.inferForegroundProcess(),
      (next) => this.handleForegroundChange(next),
      () => !this.exited,
    );
    this.foregroundWatcher.start();
  }

  get pid(): number {
    return this.pty.pid;
  }

  get shellBaseName(): string {
    return this.shellName;
  }

  get initialDocumentTitle(): string {
    return this.initialTitle;
  }

  // The title the tab was last showing — the cwd-derived form or whatever the
  // shell last set via OSC 0/2. Unlike `initialDocumentTitle` (frozen at
  // spawn), this tracks the live cwd, so a reattached session re-seeds the
  // client with its current title instead of reverting to the original spawn
  // directory.
  get currentTitle(): string {
    return this.lastEmittedTitle;
  }

  get cols(): number {
    return this.currentCols;
  }

  get rows(): number {
    return this.currentRows;
  }

  get isExited(): boolean {
    return this.exited;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get lastEmittedCwd(): string {
    return this.lastEmittedCwdValue;
  }

  // Current foreground process name (or null at the shell prompt), snapshotted
  // at attach time alongside cwd/title so a reattaching client re-syncs the
  // favicon state the watcher won't re-emit (it dedups consecutive equal
  // values). `undefined` is coerced to null for the protocol — only possible
  // mid-construction before emitInitialMetadata() runs.
  get lastEmittedForeground(): string | null {
    return this.lastEmittedForegroundValue ?? null;
  }

  // Force the session's title from the REST/CLI rename surface. The shell's
  // next OSC 0/2 title or cwd-derived title overwrites it (matching tmux, where
  // a shell that sets its own title can override `rename-session`), but until
  // then the picker and a fresh attach see the renamed title. Kept separate
  // from `initialDocumentTitle` (frozen at spawn) so the override is live.
  setTitle(title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    this.lastEmittedTitle = trimmed;
  }

  write(data: string): void {
    if (this.exited) return;
    // xterm.js's responses to DA1/DA2 flow back through here (onData -> client
    // -> server -> pty). Capture the first of each so the responder can answer
    // subsequent probes instantly without a round-trip. See
    // terminal-query-responder.ts for why the round-trip leaks.
    terminalQueryResponder.captureResponse(data);
    this.pty.write(data);
  }

  pause(): void {
    if (this.exited || this.paused) return;
    this.paused = true;
    try {
      this.pty.pause();
    } catch {
      /* PTY may have died between the exited check and the call */
    }
  }

  resume(): void {
    if (this.exited || !this.paused) return;
    this.paused = false;
    try {
      this.pty.resume();
    } catch {
      /* see pause() */
    }
  }

  resize(cols: number, rows: number, pixelWidth?: number, pixelHeight?: number): void {
    if (this.exited) return;
    if (cols <= 0 || rows <= 0) return;
    if (cols === this.currentCols && rows === this.currentRows && pixelWidth === undefined) return;
    this.currentCols = cols;
    this.currentRows = rows;
    try {
      if (pixelWidth !== undefined && pixelHeight !== undefined) {
        if (this.pixelResizeSupported === null) {
          try {
            this.pty.resize(cols, rows, pixelWidth, pixelHeight);
            this.pixelResizeSupported = true;
            return;
          } catch {
            this.pixelResizeSupported = false;
          }
        }
        if (this.pixelResizeSupported) {
          this.pty.resize(cols, rows, pixelWidth, pixelHeight);
          return;
        }
      }
      this.pty.resize(cols, rows);
    } catch {
      /* PTY may have died between checks */
    }
  }

  kill(signal: NodeJS.Signals = "SIGHUP"): void {
    if (this.exited) return;
    try {
      this.pty.kill(signal);
    } catch {
      /* already gone */
    }
  }

  dispose(): void {
    this.kill();
    this.exited = true;
    this.foregroundWatcher.dispose();
    this.cleanUpHookFiles();
    this.removeAllListeners();
  }

  // Concatenate the scrollback ring buffer for attach-time replay, prefixed
  // with a restore of the PTY's live terminal modes (alt-screen, mouse,
  // bracketed paste, cursor hide) so a switch into a long-running TUI re-enters
  // the alt screen and re-enables mouse even when the TUI's mode-set sequences
  // have scrolled out of the 256KB window — otherwise the wheel scrolls xterm's
  // scrollback instead of the TUI. DA1/DA2 identity requests never reach the
  // ring buffer: the TerminalQueryResponder removes them at append time and
  // answers them live, so the replay can't re-trigger their responses. Other
  // stale query requests (DSR/OSC/DECRQM) do remain in the raw bytes; the server
  // doesn't sanitize those (enumerating every query variant is unbounded), so
  // the client writes the whole replay as one suppressed block on
  // `replay-end`, dropping xterm's responses to any of them — a bounded fix
  // that covers any query, present or future. The join cost is paid here (read
  // time, cold switch path) not on the hot output path.
  snapshotScrollback(): string {
    return this.modeState.restorePrefix() + this.scrollbackChunks.join("");
  }

  private appendScrollback(data: string): void {
    if (!data) return;
    this.scrollbackChunks.push(data);
    this.scrollbackBytes += Buffer.byteLength(data, "utf8");
    while (
      this.scrollbackBytes > SESSION_SCROLLBACK_REPLAY_BYTES &&
      this.scrollbackChunks.length > 1
    ) {
      const dropped = this.scrollbackChunks.shift();
      if (dropped) this.scrollbackBytes -= Buffer.byteLength(dropped, "utf8");
    }
  }

  private emitInitialMetadata(): void {
    const initialTitle = formatWorkingDirectoryTitle(this.cwd);
    if (initialTitle) {
      this.initialTitle = initialTitle;
      this.lastEmittedTitle = initialTitle;
    }
    this.lastEmittedCwdValue = this.cwd;
    this.lastEmittedForegroundValue = null;
  }

  private onPtyOutput(data: string): void {
    const combined = this.pendingParse + data;
    this.pendingParse = "";

    this.modeState.update(combined);

    const osc7Path = parseOsc7FromChunk(combined);
    let cwdChanged = false;
    if (osc7Path && osc7Path !== this.lastEmittedCwdValue) {
      this.lastEmittedCwdValue = osc7Path;
      this.emit("cwd", osc7Path);
      cwdChanged = true;
    }

    const oscTitle = parseOscTitleFromChunk(combined);
    if (oscTitle) {
      const trimmed = oscTitle.trim();
      if (trimmed && trimmed !== this.lastEmittedTitle) {
        this.lastEmittedTitle = trimmed;
        this.emit("title", trimmed);
      }
    } else if (cwdChanged) {
      const cwdTitle = formatWorkingDirectoryTitle(this.lastEmittedCwdValue);
      if (cwdTitle && cwdTitle !== this.lastEmittedTitle) {
        this.lastEmittedTitle = cwdTitle;
        this.emit("title", cwdTitle);
      }
    }

    const altScreen = parseAltScreenFromChunk(combined);
    if (altScreen !== null && !altScreen) {
      this.foregroundWatcher.set(null);
    }

    const notifications = parseOscNotificationsFromChunk(combined);
    for (const body of notifications) {
      this.emit("notification", body.slice(0, MAX_NOTIFICATION_LENGTH));
    }

    if (parseOscDirtyFromChunk(combined)) {
      this.emit("git-dirty");
    }

    if (this.reportInitialCommandExit && !this.hasEmittedAutomationExit) {
      const automationExitCode = parseOscAutomationExitFromChunk(combined);
      if (automationExitCode !== null) {
        this.hasEmittedAutomationExit = true;
        this.emit("automation-exit", automationExitCode);
      }
    }

    const lastEsc = combined.lastIndexOf("\x1b");
    if (lastEsc !== -1 && combined.length - lastEsc <= MAX_PENDING_PARSE_BYTES) {
      const tail = combined.slice(lastEsc);
      if (this.hasIncompleteOsc(tail)) {
        this.pendingParse = tail;
      }
    }
  }

  private hasIncompleteOsc(tail: string): boolean {
    if (tail.length < 2) return true;
    if (tail[1] !== "]") return false;
    return tail.indexOf("\x07", 2) === -1 && tail.indexOf("\x1b\\", 2) === -1;
  }

  private prepareOsc7Hook(
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
          'PROMPT_COMMAND="${PROMPT_COMMAND:+${PROMPT_COMMAND};}__localterm_osc7_prompt;__localterm_git_dirty"',
          "__localterm_osc7_prompt",
          "__localterm_git_dirty() { printf '\\e]7777;git-dirty\\a'; }",
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
        // A single fish_prompt handler captures $status FIRST (before any
        // printf mutates it) so the automation-exit emit on prompt #2 reports
        // the real command exit code, then emits the git-dirty signal.
        // Splitting these into two --on-event handlers would let the git-dirty
        // printf reset $status to 0 before the exit handler read it.
        const lines = [
          "function __localterm_osc7 --on-variable PWD",
          "    printf '\\e]7;file://%s%s\\a' (hostname 2>/dev/null || echo localhost) $PWD",
          "end",
          "__localterm_osc7",
          shimsPrepend,
          ...(this.reportInitialCommandExit
            ? ["set -g __localterm_automation_prompt_count 0"]
            : []),
          "function __localterm_prompt_hook --on-event fish_prompt",
          "    set -l __localterm_exit $status",
          "    printf '\\e]7777;git-dirty\\a'",
          ...(this.reportInitialCommandExit
            ? [
                "    set -g __localterm_automation_prompt_count (math $__localterm_automation_prompt_count + 1)",
                '    if test "$__localterm_automation_prompt_count" -eq 2',
                "        printf '\\e]7777;automation-exit;%d\\a' $__localterm_exit",
                "    end",
              ]
            : []),
          "end",
        ];
        return [["-C", lines.join("\n")], null];
      }
      default:
        return [[], null];
    }
  }

  // The initial command is buffered into the PTY at spawn, so prompt #1 is
  // the one the command echoes at and prompt #2 is the first one after it
  // finishes — that's the only cycle where $? is the command's exit status.
  // The hook must run FIRST in the prompt chain (prepended), otherwise the
  // osc7/git-dirty hooks' printf would have already reset $? to 0.
  private automationExitHookFunctionLines(functionName: string): string[] {
    return [
      "__localterm_automation_prompt_count=0",
      `${functionName}() {`,
      "  local __localterm_command_exit=$?",
      "  __localterm_automation_prompt_count=$((__localterm_automation_prompt_count + 1))",
      '  if [ "$__localterm_automation_prompt_count" -eq 2 ]; then',
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

  private handleForegroundChange(next: string | null): void {
    const hadForeground = this.lastEmittedForegroundValue != null;
    this.lastEmittedForegroundValue = next;
    this.emit("foreground", next);
    if (hadForeground && next === null) {
      const cwdTitle = formatWorkingDirectoryTitle(this.lastEmittedCwdValue);
      if (cwdTitle && cwdTitle !== this.lastEmittedTitle) {
        this.lastEmittedTitle = cwdTitle;
        this.emit("title", cwdTitle);
      }
    }
  }

  private inferForegroundProcess(): string | null {
    const raw = this.pty.process?.trim() ?? "";
    if (!raw) return null;
    if (this.shellProcessNames.has(raw)) return null;
    // An unknown name is either the shell under an alias (idle /bin/sh reports
    // "bash", not the invoked "sh") or a genuine foreground program. The
    // terminal's foreground group id disambiguates without depending on the
    // shell's proctitle timing: the shell is its own pgrp leader holding the
    // terminal at idle (tpgid == pty.pid), a foreground program runs in its own
    // group (tpgid != pty.pid). When tpgid confirms the shell is idle the
    // current reading IS the shell's alias name — learn it (cached per shell
    // path, see utils/shell-process-name.ts, so the sync ps runs at most once
    // per aliased path) and report no foreground; otherwise the name is a real
    // program, reported as foreground. macOS-only: Linux node-pty reads
    // /proc/<pgrp>/cmdline (the invoked name, already in the set), so an unknown
    // name there is just a foreground program.
    if (process.platform === "darwin") {
      const confirmed = confirmShellProcessName(this.shell, this.pty.pid, raw);
      if (confirmed) {
        this.shellProcessNames.add(confirmed);
        if (confirmed === raw) return null;
      }
    }
    return raw;
  }

  private cleanUpHookFiles(): void {
    for (const hookPath of this.hookCleanupPaths) {
      try {
        rmSync(hookPath, { recursive: true, force: true });
      } catch {
        /* temp files may already be removed or inaccessible */
      }
    }
    this.hookCleanupPaths = [];
  }
}
