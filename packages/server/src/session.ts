import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import {
  COLORTERM_VALUE,
  DEFAULT_COLS,
  DEFAULT_ROWS,
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
import { parseOscTitleFromChunk } from "./utils/parse-osc-title.js";

interface SessionEvents {
  output: [data: string];
  exit: [code: number | null];
  title: [title: string];
  cwd: [cwd: string];
  foreground: [process: string | null];
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
  private lastEmittedTitle = "";
  private lastEmittedCwd = "";
  private lastEmittedForeground: string | null | undefined = undefined;

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

    this.pty = spawn(this.shell, [], {
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
    this.injectOsc7Hook();
  }

  get pid(): number {
    return this.pty.pid;
  }

  get shellBaseName(): string {
    return this.shellName;
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

  resize(cols: number, rows: number): void {
    if (this.exited) return;
    if (cols <= 0 || rows <= 0) return;
    if (cols === this.currentCols && rows === this.currentRows) return;
    this.currentCols = cols;
    this.currentRows = rows;
    try {
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
    this.removeAllListeners();
  }

  private emitInitialMetadata(): void {
    const initialTitle = formatWorkingDirectoryTitle(this.cwd);
    if (initialTitle) {
      this.lastEmittedTitle = initialTitle;
      this.emit("title", initialTitle);
    }
    this.lastEmittedCwd = this.cwd;
    this.emit("cwd", this.cwd);

    this.lastEmittedForeground = null;
    this.emit("foreground", null);
  }

  private onPtyOutput(data: string): void {
    const osc7Path = parseOsc7FromChunk(data);
    let cwdChanged = false;
    if (osc7Path && osc7Path !== this.lastEmittedCwd) {
      this.lastEmittedCwd = osc7Path;
      this.emit("cwd", osc7Path);
      cwdChanged = true;
    }

    const oscTitle = parseOscTitleFromChunk(data);
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

    const altScreen = parseAltScreenFromChunk(data);
    if (altScreen !== null) {
      const nextForeground = altScreen ? this.inferForegroundProcess() : null;
      if (nextForeground !== this.lastEmittedForeground) {
        this.lastEmittedForeground = nextForeground;
        this.emit("foreground", nextForeground);
      }
    }
  }

  private injectOsc7Hook(): void {
    // Fish emits OSC 7 natively; zsh and bash do not. Inject a small
    // chpwd / PROMPT_COMMAND hook so every directory change produces an
    // OSC 7 sequence that our stream parser can pick up.
    const hook = this.osc7HookForShell(this.shellName);
    if (hook) this.pty.write(hook);
  }

  private osc7HookForShell(shellName: string): string | null {
    switch (shellName) {
      case "zsh": {
        const register =
          "chpwd_functions=(${chpwd_functions[@]} __localterm_osc7_chpwd)";
        const fire = "__localterm_osc7_chpwd";
        return [
          this.zshOsc7ChpwdFunction(),
          register,
          fire,
        ].join("\n") + "\n";
      }
      case "bash": {
        const func = this.bashOsc7Function();
        const assign =
          'PROMPT_COMMAND="${PROMPT_COMMAND:+${PROMPT_COMMAND};}__localterm_osc7_prompt"';
        const fire = "__localterm_osc7_prompt";
        return [func, assign, fire].join("\n") + "\n";
      }
      default:
        return null;
    }
  }

  private zshOsc7ChpwdFunction(): string {
    return [
      "__localterm_osc7_chpwd() {",
      "  printf '\\e]7;file://%s%s\\a' \"${HOSTNAME:-localhost}\" \"${PWD}\"",
      "}",
    ].join("\n");
  }

  private bashOsc7Function(): string {
    return [
      "__localterm_osc7_prompt() {",
      "  printf '\\e]7;file://%s%s\\a' \"${HOSTNAME:-localhost}\" \"${PWD}\"",
      "}",
    ].join("\n");
  }

  private inferForegroundProcess(): string | null {
    const raw = this.pty.process?.trim() ?? "";
    return raw && raw !== this.shellName ? raw : null;
  }
}
