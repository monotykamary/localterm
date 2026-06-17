import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import {
  COLORTERM_VALUE,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  FOREGROUND_POLL_INTERVAL_MS,
  LOCALTERM_VALUE,
  MAX_NOTIFICATION_LENGTH,
  MAX_PENDING_PARSE_BYTES,
  PTY_ENV_DENYLIST,
  TERM_TYPE,
} from "./constants.js";
// Titles are emitted on a dedicated `title` event so they travel as a separate
// WebSocket frame. We deliberately do NOT splice OSC sequences into the PTY
// output stream — doing so corrupts in-flight escape sequences from modern
// TUIs (e.g. Cursor Agent / Claude Code use DECSET 2026 synchronized output
// mode and any byte landing inside that frame breaks the parser state).
import { ensureSpawnHelperExecutable } from "./ensure-spawn-helper-executable.js";
import { getDefaultShell } from "./default-shell.js";
import type { SpawnPtyInput } from "./types.js";
import { formatWorkingDirectoryTitle } from "./utils/format-working-directory-title.js";
import { parseAltScreenFromChunk } from "./utils/parse-alt-screen.js";
import { parseOsc7FromChunk } from "./utils/parse-osc7.js";
import { parseOscAutomationExitFromChunk } from "./utils/parse-osc-automation-exit.js";
import { parseOscDirtyFromChunk } from "./utils/parse-osc-dirty.js";
import { parseOscNotificationsFromChunk } from "./utils/parse-osc-notification.js";
import { parseOscTitleFromChunk } from "./utils/parse-osc-title.js";

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

  private readonly pty: IPty;
  private readonly shellName: string;
  private currentCols: number;
  private currentRows: number;
  private exited = false;
  private paused = false;
  private initialTitle = "";
  private lastEmittedTitle = "";
  private lastEmittedCwdValue = "";
  private lastEmittedForeground: string | null | undefined = undefined;
  private pixelResizeSupported: boolean | null = null;
  private hookCleanupPaths: string[] = [];
  private pendingParse = "";
  private foregroundPollTimer: NodeJS.Timeout | null = null;
  private readonly reportInitialCommandExit: boolean;
  private hasEmittedAutomationExit = false;

  constructor(input: SpawnPtyInput) {
    super();
    ensureSpawnHelperExecutable();
    this.shell = input.shell ?? getDefaultShell();
    this.shellName = path.basename(this.shell);
    this.cwd = input.cwd ?? os.homedir();
    this.currentCols = input.cols ?? DEFAULT_COLS;
    this.currentRows = input.rows ?? DEFAULT_ROWS;
    this.createdAt = Date.now();
    this.reportInitialCommandExit = Boolean(input.initialCommand);

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
      this.onPtyOutput(data);
      this.emit("output", data);
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
    this.startForegroundPoll();
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

  write(data: string): void {
    if (this.exited) return;
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
    if (this.foregroundPollTimer !== null) {
      clearInterval(this.foregroundPollTimer);
      this.foregroundPollTimer = null;
    }
    this.cleanUpHookFiles();
    this.removeAllListeners();
  }

  private emitInitialMetadata(): void {
    const initialTitle = formatWorkingDirectoryTitle(this.cwd);
    if (initialTitle) {
      this.initialTitle = initialTitle;
      this.lastEmittedTitle = initialTitle;
    }
    this.lastEmittedCwdValue = this.cwd;
    this.lastEmittedForeground = null;
  }

  private onPtyOutput(data: string): void {
    const combined = this.pendingParse + data;
    this.pendingParse = "";

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
      this.emitForegroundIfChanged(null);
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
        const escapedZdotdir = userZdotdir.replace(/'/g, "'\\''");
        const lines = [
          `source '${escapedZdotdir}/.zshenv' 2>/dev/null`,
          '__localterm_saved_zdotdir="${ZDOTDIR}"',
          `ZDOTDIR='${escapedZdotdir}'`,
          `source '${escapedZdotdir}/.zshrc' 2>/dev/null`,
          'ZDOTDIR="${__localterm_saved_zdotdir}"',
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
        const lines = [
          "source /etc/bashrc 2>/dev/null",
          "source /etc/bash.bashrc 2>/dev/null",
          "source ~/.bashrc 2>/dev/null",
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

  private startForegroundPoll(): void {
    this.foregroundPollTimer = setInterval(() => {
      if (this.exited) {
        clearInterval(this.foregroundPollTimer!);
        this.foregroundPollTimer = null;
        return;
      }
      const next = this.inferForegroundProcess();
      this.emitForegroundIfChanged(next);
    }, FOREGROUND_POLL_INTERVAL_MS);
    this.foregroundPollTimer.unref?.();
  }

  private emitForegroundIfChanged(next: string | null): void {
    if (next !== this.lastEmittedForeground) {
      const hadForeground = this.lastEmittedForeground != null;
      this.lastEmittedForeground = next;
      this.emit("foreground", next);
      if (hadForeground && next === null) {
        const cwdTitle = formatWorkingDirectoryTitle(this.lastEmittedCwdValue);
        if (cwdTitle && cwdTitle !== this.lastEmittedTitle) {
          this.lastEmittedTitle = cwdTitle;
          this.emit("title", cwdTitle);
        }
      }
    }
  }

  private inferForegroundProcess(): string | null {
    const raw = this.pty.process?.trim() ?? "";
    return raw && raw !== this.shellName ? raw : null;
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
