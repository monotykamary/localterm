import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import {
  COLORTERM_VALUE,
  DEFAULT_COLS,
  DEFAULT_ROWS,
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
import { parseOscNotificationsFromChunk } from "./utils/parse-osc-notification.js";
import { parseOscTitleFromChunk } from "./utils/parse-osc-title.js";

interface SessionEvents {
  output: [data: string];
  exit: [code: number | null];
  title: [title: string];
  cwd: [cwd: string];
  foreground: [process: string | null];
  notification: [body: string];
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
  private lastEmittedCwd = "";
  private lastEmittedForeground: string | null | undefined = undefined;
  private hookCleanupPaths: string[] = [];
  private pendingParse = "";

  constructor(input: SpawnPtyInput) {
    super();
    ensureSpawnHelperExecutable();
    this.shell = input.shell ?? getDefaultShell();
    this.shellName = path.basename(this.shell);
    this.cwd = input.cwd ?? os.homedir();
    this.currentCols = input.cols ?? DEFAULT_COLS;
    this.currentRows = input.rows ?? DEFAULT_ROWS;
    this.createdAt = Date.now();

    const env: Record<string, string> = {};
    const denied = new Set(PTY_ENV_DENYLIST);
    for (const [key, value] of Object.entries(process.env)) {
      if (denied.has(key)) continue;
      if (typeof value === "string") env[key] = value;
    }
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

    this.emitInitialMetadata();
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
      this.pty.resize(cols, rows, pixelWidth, pixelHeight);
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
    this.cleanUpHookFiles();
    this.removeAllListeners();
  }

  private emitInitialMetadata(): void {
    const initialTitle = formatWorkingDirectoryTitle(this.cwd);
    if (initialTitle) {
      this.initialTitle = initialTitle;
      this.lastEmittedTitle = initialTitle;
      this.emit("title", initialTitle);
    }
    this.lastEmittedCwd = this.cwd;
    this.emit("cwd", this.cwd);

    this.lastEmittedForeground = null;
    this.emit("foreground", null);
  }

  private onPtyOutput(data: string): void {
    const combined = this.pendingParse + data;
    this.pendingParse = "";

    const osc7Path = parseOsc7FromChunk(combined);
    let cwdChanged = false;
    if (osc7Path && osc7Path !== this.lastEmittedCwd) {
      this.lastEmittedCwd = osc7Path;
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
      const cwdTitle = formatWorkingDirectoryTitle(this.lastEmittedCwd);
      if (cwdTitle && cwdTitle !== this.lastEmittedTitle) {
        this.lastEmittedTitle = cwdTitle;
        this.emit("title", cwdTitle);
      }
    }

    const altScreen = parseAltScreenFromChunk(combined);
    if (altScreen !== null) {
      const nextForeground = altScreen ? this.inferForegroundProcess() : null;
      if (nextForeground !== this.lastEmittedForeground) {
        this.lastEmittedForeground = nextForeground;
        this.emit("foreground", nextForeground);
      }
    }

    const notifications = parseOscNotificationsFromChunk(combined);
    for (const body of notifications) {
      this.emit("notification", body.slice(0, MAX_NOTIFICATION_LENGTH));
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
        mkdirSync(hookDir, { recursive: true });
        this.hookCleanupPaths.push(hookDir);
        const hookScript = this.zshOsc7ChpwdFunction();
        const userZdotdir = env.ZDOTDIR || os.homedir();
        const escapedZdotdir = userZdotdir.replace(/'/g, "'\\''");
        const lines = [
          `source '${escapedZdotdir}/.zshenv' 2>/dev/null`,
          `source '${escapedZdotdir}/.zshrc' 2>/dev/null`,
          hookScript,
          "chpwd_functions=(${chpwd_functions[@]} __localterm_osc7_chpwd)",
          "__localterm_osc7_chpwd",
        ];
        writeFileSync(path.join(hookDir, ".zshrc"), lines.join("\n") + "\n", {
          mode: 0o644,
        });
        return [[], { ZDOTDIR: hookDir, __LOCALTERM_ORIG_ZDOTDIR: userZdotdir }];
      }
      case "bash": {
        const hookPath = path.join(os.tmpdir(), `localterm-bashrc-${hookId}`);
        this.hookCleanupPaths.push(hookPath);
        const hookScript = this.bashOsc7Function();
        const lines = [
          "source /etc/bashrc 2>/dev/null",
          "source /etc/bash.bashrc 2>/dev/null",
          "source ~/.bashrc 2>/dev/null",
          hookScript,
          'PROMPT_COMMAND="${PROMPT_COMMAND:+${PROMPT_COMMAND};}__localterm_osc7_prompt"',
          "__localterm_osc7_prompt",
        ];
        writeFileSync(hookPath, lines.join("\n") + "\n", { mode: 0o644 });
        return [["--rcfile", hookPath], null];
      }
      default:
        return [[], null];
    }
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
