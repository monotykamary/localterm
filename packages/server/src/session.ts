import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import {
  COLORTERM_VALUE,
  CWD_RESOLVE_BACKOFF_MS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  PTY_ENV_DENYLIST,
  TERM_TYPE,
  TITLE_POLL_INTERVAL_MS,
} from "./constants.js";
import { ensureSpawnHelperExecutable } from "./ensure-spawn-helper-executable.js";
import { getDefaultShell } from "./default-shell.js";
import type { SpawnPtyInput } from "./types.js";
import { encodeOscTitle } from "./utils/encode-osc-title.js";
import { formatWorkingDirectoryTitle } from "./utils/format-working-directory-title.js";
import { resolveCwdForPid } from "./utils/resolve-cwd-for-pid.js";

interface SessionEvents {
  output: [data: string];
  exit: [code: number | null];
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
  private titlePollTimer: NodeJS.Timeout | null = null;
  private lastEmittedTitle = "";
  private nextCwdResolveAt = 0;

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

  get cols(): number {
    return this.currentCols;
  }

  get rows(): number {
    return this.currentRows;
  }

  get isExited(): boolean {
    return this.exited;
  }

  write(data: string): void {
    if (this.exited) return;
    this.pty.write(data);
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
    this.exited = true;
    this.stopTitlePolling();
    this.kill();
    this.removeAllListeners();
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
      const nextTitle = await this.computeTitle();
      if (this.exited) return;
      if (nextTitle && nextTitle !== this.lastEmittedTitle) {
        this.lastEmittedTitle = nextTitle;
        this.emit("output", encodeOscTitle(nextTitle));
      }
    } catch {
      /* polling errors are non-fatal; the next tick will retry */
    } finally {
      this.scheduleTitlePoll(TITLE_POLL_INTERVAL_MS);
    }
  }

  private async computeTitle(): Promise<string | null> {
    const foreground = this.pty.process?.trim() ?? "";
    if (foreground && foreground !== this.shellName) return foreground;
    const liveCwd = await this.resolveLiveCwd();
    return formatWorkingDirectoryTitle(liveCwd ?? this.cwd);
  }

  private async resolveLiveCwd(): Promise<string | null> {
    const now = Date.now();
    if (now < this.nextCwdResolveAt) return null;
    const liveCwd = await resolveCwdForPid(this.pid).catch(() => null);
    if (liveCwd === null) {
      this.nextCwdResolveAt = now + CWD_RESOLVE_BACKOFF_MS;
    } else {
      this.nextCwdResolveAt = 0;
    }
    return liveCwd;
  }

  private stopTitlePolling(): void {
    if (this.titlePollTimer === null) return;
    clearTimeout(this.titlePollTimer);
    this.titlePollTimer = null;
  }
}
