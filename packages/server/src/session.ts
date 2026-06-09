import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import {
  COLORTERM_VALUE,
  CWD_RESOLVE_BACKOFF_MS,
  CWD_RESOLVE_COOLDOWN_MS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  PTY_ENV_DENYLIST,
  TERM_TYPE,
  TITLE_POLL_INTERVAL_MS,
} from "./constants.js";
// Note: titles are emitted on a dedicated `title` event so they travel as a
// separate WebSocket frame. We deliberately do NOT splice OSC sequences into
// the PTY output stream — doing so corrupts in-flight escape sequences from
// modern TUIs (e.g. Cursor Agent / Claude Code use DECSET 2026 synchronized
// output mode and any byte landing inside that frame breaks the parser state).
import { ensureSpawnHelperExecutable } from "./ensure-spawn-helper-executable.js";
import { getDefaultShell } from "./default-shell.js";
import type { SpawnPtyInput } from "./types.js";
import { formatWorkingDirectoryTitle } from "./utils/format-working-directory-title.js";
import { parseOsc7FromChunk } from "./utils/parse-osc7.js";
import { resolveCwdForPid } from "./utils/resolve-cwd-for-pid.js";

interface SessionEvents {
  output: [data: string];
  exit: [code: number | null];
  title: [title: string];
  cwd: [cwd: string];
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
  private titlePollTimer: NodeJS.Timeout | null = null;
  private lastEmittedTitle = "";
  private lastEmittedCwd = "";
  private nextCwdResolveAt = 0;
  // Set to true once OSC 7 is observed from the PTY output. Once the shell
  // advertises its working directory via OSC 7 we stop polling lsof entirely —
  // the stream is the source of truth and lsof is just an expensive fallback.
  private osc7Detected = false;

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
      this.stopTitlePolling();
      this.emit("exit", exitCode);
    });

    this.scheduleTitlePoll(0);
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

  /**
   * Stop reading data from the PTY. node-pty buffers further child output in
   * the OS pipe; once that fills, write() in the child process blocks, which
   * propagates flow control all the way back to the producing program (e.g.
   * `cat large_file`). Used by the WS layer to pause heavy output streams
   * when the outbound socket buffer is filling, so we don't have to kill the
   * connection just to recover memory.
   */
  pause(): void {
    if (this.exited || this.paused) return;
    this.paused = true;
    try {
      this.pty.pause();
    } catch {
      /* PTY may have died between the exited check and the call */
    }
  }

  /**
   * Reverse of `pause()`. Buffered child output starts flowing again and the
   * child process unblocks if it was stuck in write().
   */
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
    this.stopTitlePolling();
    this.removeAllListeners();
  }

  private onPtyOutput(data: string): void {
    const osc7Path = parseOsc7FromChunk(data);
    if (osc7Path) {
      this.osc7Detected = true;
      if (osc7Path !== this.lastEmittedCwd) {
        this.lastEmittedCwd = osc7Path;
        this.emit("cwd", osc7Path);
      }
    }
  }

  private scheduleTitlePoll(delayMs: number): void {
    if (this.exited) return;
    this.titlePollTimer = setTimeout(() => {
      void this.runTitlePoll();
    }, delayMs);
    this.titlePollTimer.unref();
  }

  private async runTitlePoll(): Promise<void> {
    if (this.exited) return;
    try {
      // Once the shell advertises its CWD via OSC 7 we skip lsof — the stream
      // is authoritative and lsof is expensive (spawns a child process that
      // triggers syspolicyd validation on every call).
      const liveCwd = this.osc7Detected ? this.lastEmittedCwd || null : await this.resolveLiveCwd();
      if (this.exited) return;
      if (!this.osc7Detected && liveCwd && liveCwd !== this.lastEmittedCwd) {
        this.lastEmittedCwd = liveCwd;
        this.emit("cwd", liveCwd);
      }
      const nextTitle = this.computeTitle(
        this.osc7Detected ? this.lastEmittedCwd || this.cwd : (liveCwd ?? this.cwd),
      );
      if (nextTitle && nextTitle !== this.lastEmittedTitle) {
        this.lastEmittedTitle = nextTitle;
        this.emit("title", nextTitle);
      }
    } catch {
      /* polling errors are non-fatal; the next tick will retry */
    } finally {
      this.scheduleTitlePoll(TITLE_POLL_INTERVAL_MS);
    }
  }

  private computeTitle(liveCwd: string): string | null {
    const foreground = this.pty.process?.trim() ?? "";
    if (foreground && foreground !== this.shellName) return foreground;
    return formatWorkingDirectoryTitle(liveCwd);
  }

  private async resolveLiveCwd(): Promise<string | null> {
    const now = Date.now();
    if (now < this.nextCwdResolveAt) return null;
    const liveCwd = await resolveCwdForPid(this.pid).catch(() => null);
    this.nextCwdResolveAt =
      now + (liveCwd === null ? CWD_RESOLVE_BACKOFF_MS : CWD_RESOLVE_COOLDOWN_MS);
    return liveCwd;
  }

  private stopTitlePolling(): void {
    if (this.titlePollTimer === null) return;
    clearTimeout(this.titlePollTimer);
    this.titlePollTimer = null;
  }
}
