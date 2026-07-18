import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import {
  ALT_SCREEN_FOREGROUND,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  HOOKED_SHELL_NAMES,
  MAX_NOTIFICATION_LENGTH,
  MAX_PENDING_PARSE_BYTES,
  SESSION_SCROLLBACK_REPLAY_BYTES,
  TERM_TYPE,
} from "./constants.js";
// Titles are emitted on a dedicated `title` event so they travel as a separate
// WebSocket frame. We deliberately do NOT splice OSC sequences into the PTY
// output stream — doing so corrupts in-flight escape sequences from modern
// TUIs (e.g. Cursor Agent / Claude Code use DECSET 2026 synchronized output
// mode and any byte landing inside that frame breaks the parser state).
import { buildPtyEnvironment } from "./build-pty-environment.js";
import { ensureSpawnHelperExecutable } from "./ensure-spawn-helper-executable.js";
import { getDefaultShell } from "./default-shell.js";
import { ShellHookBuilder } from "./shell-hook-builder.js";
import type { SpawnPtyInput } from "./types.js";
import { formatWorkingDirectoryTitle } from "./utils/format-working-directory-title.js";
import { parseAltScreenFromChunk } from "./utils/parse-alt-screen.js";
import { parseOsc7FromChunk } from "./utils/parse-osc7.js";
import { parseOscAutomationExitFromChunk } from "./utils/parse-osc-automation-exit.js";
import { parseOscDirtyFromChunk } from "./utils/parse-osc-dirty.js";
import { parseOscNotificationsFromChunk } from "./utils/parse-osc-notification.js";
import { parseOscForegroundFromChunk } from "./utils/parse-osc-foreground.js";
import { parseOscTitleFromChunk } from "./utils/parse-osc-title.js";
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
  // Foreground state from the shell hook (preexec/precmd) — the authoritative
  // source. null = the shell is at its prompt (precmd emitted fg-idle); a
  // string = a program is running (preexec emitted fg;<token>). Takes
  // precedence over altScreenActive so a hooked shell's named program wins
  // over the alt-screen fallback.
  private foregroundFromHook: string | null = null;
  // Whether a TUI is currently on the alternate screen (DECSET/DECRST 1049).
  // The fallback foreground signal for shells without a preexec hook (sh/dash):
  // a TUI entering the alt screen marks the session alive even without a named
  // program, so a closed tab never reaps a running editor. A hooked shell's
  // preexec names the program first, so this only fills the gap for unhooked
  // shells (sh/dash).
  private altScreenActive = false;
  private currentCols: number;
  private currentRows: number;
  private exited = false;
  private paused = false;
  private initialTitle = "";
  private lastEmittedTitle = "";
  private lastEmittedCwdValue = "";
  private lastEmittedForegroundValue: string | null = null;
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
    this.cwd = input.cwd ?? os.homedir();
    this.currentCols = input.cols ?? DEFAULT_COLS;
    this.currentRows = input.rows ?? DEFAULT_ROWS;
    this.createdAt = Date.now();
    this.id = randomUUID();
    this.reportInitialCommandExit = Boolean(input.initialCommand);
    this.shimsDir = input.shimsDir;

    const env = buildPtyEnvironment({ input, sessionId: this.id });

    const shellHookBuilder = new ShellHookBuilder({
      shimsDir: this.shimsDir,
      reportInitialCommandExit: this.reportInitialCommandExit,
    });
    const [shellArgs, shellEnv] = shellHookBuilder.prepare(this.shellName, env);
    this.hookCleanupPaths.push(...shellHookBuilder.hookCleanupPaths);
    if (shellEnv) {
      for (const [key, value] of Object.entries(shellEnv)) {
        env[key] = value;
      }
    }

    // An initial command (an "open in neovim" tab, a worktree's setup script,
    // an automation shell-runner command) runs one of two ways:
    //  - Hooked shells (zsh/bash/fish) run it via the prompt hook (eval), so it
    //    never goes through the line editor's typed-input path and can't race
    //    ECHO or double-echo. The command is passed through the
    //    LOCALTERM_INITIAL_COMMAND env var; the hook evals it, emits the
    //    automation-exit OSC, and unsets it.
    //  - Unhooked shells (sh/dash/arbitrary) get the at-spawn PTY write — they
    //    have no prompt hook to eval with.
    const useHookEval = !!input.initialCommand && HOOKED_SHELL_NAMES.has(this.shellName);
    if (input.initialCommand && useHookEval) {
      env.LOCALTERM_INITIAL_COMMAND = input.initialCommand;
    }

    this.pty = spawn(this.shell, shellArgs, {
      name: TERM_TYPE,
      cols: this.currentCols,
      rows: this.currentRows,
      cwd: this.cwd,
      env,
    });

    this.pty.onData((data) => {
      // Intercept standalone DA1/DA2 identity queries: answer them from the
      // cached xterm response instantly (in-process, no round-trip to xterm) and
      // remove the request from the output so xterm never sees or answers it.
      // Without this the remote round-trip loses the race against a short read
      // timeout or a process exit, orphaning the response in the PTY stdin as
      // typed text (e.g. `62;4;9;22c`). Cold or mixed chunk: the request
      // round-trips to xterm so earlier query replies retain wire order, and the
      // response is captured in write(). Only intercepted standalone requests
      // are removed from client output and scrollback.
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

    if (input.initialCommand && !useHookEval) {
      this.pty.write(`${input.initialCommand}\r`);
    }

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

  // Current foreground value (a program name, the alt-screen marker, or null
  // at the shell prompt), snapshotted at attach time alongside cwd/title so a
  // reattaching client re-syncs the favicon state the deduping emitter won't
  // re-emit on its own.
  get lastEmittedForeground(): string | null {
    return this.lastEmittedForegroundValue;
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
    this.cleanUpHookFiles();
    this.removeAllListeners();
  }

  // Concatenate the scrollback ring buffer for attach-time replay, prefixed
  // with a restore of the PTY's live terminal modes (alt-screen, mouse,
  // bracketed paste, cursor hide) so a switch into a long-running TUI re-enters
  // the alt screen and re-enables mouse even when the TUI's mode-set sequences
  // have scrolled out of the 256KB window — otherwise the wheel scrolls xterm's
  // scrollback instead of the TUI. Warm standalone DA1/DA2 requests never reach
  // the ring buffer: the TerminalQueryResponder removes and answers them live.
  // Cold or mixed DA requests, like DSR/OSC/DECRQM queries, remain in the raw
  // bytes because the server cannot reorder or exhaustively sanitize them. The
  // client writes the whole replay as one suppressed block on
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
    if (altScreen !== null) {
      this.handleAltScreenChange(altScreen);
    }

    const foregroundSignal = parseOscForegroundFromChunk(combined);
    if (foregroundSignal !== undefined) {
      this.handleForegroundChange(foregroundSignal);
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

  private handleForegroundChange(next: string | null): void {
    this.foregroundFromHook = next;
    this.emitEffectiveForeground();
  }

  private handleAltScreenChange(entered: boolean): void {
    this.altScreenActive = entered;
    this.emitEffectiveForeground();
  }

  // Combine the hook signal (authoritative: a named program or idle) with the
  // alt-screen fallback (a TUI is on screen but no hook named it), dedup against
  // the last emitted value, and broadcast. The hook always wins — a hooked
  // shell's preexec names the program before the TUI enters the alt screen, so
  // the alt-screen marker only fills the gap for shells without a preexec hook
  // (sh/dash). On the idle transition (a program exits and
  // the shell returns to its prompt) the title reverts to the cwd-derived form.
  private emitEffectiveForeground(): void {
    const next = this.foregroundFromHook ?? (this.altScreenActive ? ALT_SCREEN_FOREGROUND : null);
    if (next === this.lastEmittedForegroundValue) return;
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
