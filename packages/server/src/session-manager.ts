import path from "node:path";
import type { CaptureRenderer } from "./capture-renderer.js";
import { SESSION_GRACE_MS, SESSION_PENDING_PROMOTE_TIMEOUT_MS } from "./constants.js";
import { GitDiffWatcher } from "./git-diff-watcher.js";
import type { GitMetadataCoordinator } from "./git-metadata-coordinator.js";
import { Session } from "./session.js";
import { SessionClientHub } from "./session-client-hub.js";
import { SessionCommandExecutor } from "./session-command-executor.js";
import { SessionGitEventBridge } from "./session-git-event-bridge.js";
import { SessionLifecyclePolicy } from "./session-lifecycle-policy.js";
import { SessionOutputCoordinator } from "./session-output-coordinator.js";
import { SessionOutputTransport, type BrotliEncoder } from "./session-output-transport.js";
import type { SessionEventName } from "./session-event-manager.js";
import type {
  GitBranchPr,
  ServerToClientMessage,
  SessionClientProfile,
  SpawnPtyInput,
} from "./types.js";
import type { CompressMode } from "./schemas.js";
import type { SessionOwner } from "./identity/types.js";

import {
  createSynchronizedOutputEndDetector,
  type SynchronizedOutputEndDetector,
} from "./utils/create-synchronized-output-end-detector.js";
import { resolveNamedKeys } from "./utils/named-keys.js";
import { deletePasteImagesForSession } from "./utils/paste-image-store.js";
import type { ClientSocket } from "./utils/ws-socket.js";
import type { WorkspaceEntry } from "./workspace-store.js";

export interface AutomationContext {
  automationId: string;
  runId: string;
}

// The synchronous command-and-capture primitive (the tmux send-keys +
// capture-pane replacement, but blocking). One call runs a single shell command
// line inside a session, captures its rendered output, and returns the exit
// code — the shape an agent turn maps to directly. `output` is ANSI-processed
// clean text (rendered through a headless xterm); `timedOut` marks a command
// that didn't finish within `timeoutMs`; `truncated` marks output past the
// `outputLimitBytes` cap. `exitCode` is the command's exit status, or null when
// the call timed out (the command may still be running) or the session exited.
export interface ExecResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export interface ExecOptions {
  timeoutMs?: number;
  outputLimitBytes?: number;
}

// Predicate for the `wait` primitive. `kind` discriminates the match strategy so
// the manager can special-case idle (poll recency) vs text/regex (flush + test
// on every output frame). `test` runs against the flushed capture-renderer
// pane text (ANSI-processed, the same grid `capture-pane` returns).
export interface WaitPredicate {
  kind: "text" | "regex" | "idle";
  test: (text: string) => boolean;
}

export interface WaitResult {
  matched: boolean;
  elapsedMs: number;
  snapshot: string;
}

// Favicon-equivalent activity state, computed server-side from output recency
// and foreground status. "running" = output within SESSION_ACTIVITY_WINDOW_MS
// (the tab favicon turns green); "alive-quiet" = a foreground program is still
// running but output has gone quiet (the favicon turns blue); "ready" = idle at
// the shell prompt (the favicon turns grey). Surfaced on the session list so a
// glance shows what's actively producing vs waiting, and gates the grace reap
// so a quiet-but-running shell isn't reaped.
export type SessionActivityState = "running" | "alive-quiet" | "ready";

export interface ManagedClient {
  ws: ClientSocket;
  pending: boolean;
  // Buffered while pending: live output bytes and control messages are queued
  // here (not sent) until the client sends {type:"ready"} or the pending
  // timeout auto-promotes it. Flushed in order on promote so nothing is lost
  // and the scrollback replay (when requested) lands first.
  pendingControl: ServerToClientMessage[];
  pendingBytes: Uint8Array<ArrayBuffer>[];
  pendingTimer: NodeJS.Timeout | null;
  cols: number;
  rows: number;
  focused: boolean;
  lastActivitySequence: number;
  pixelWidth?: number;
  pixelHeight?: number;
  // The per-browser-profile handle this tab carried on the WS upgrade (the
  // `?wid=` query param). Shared by every tab/window of one browser profile
  // (minted client-side into localStorage, which the browser partitions per
  // profile), so the session list can group a row's attached clients by
  // profile for the picker's peer display. `""` for a back-compat client that
  // didn't send one.
  windowId: string;
  coordinator: GitMetadataCoordinator | null;
  compressMode: CompressMode;
  brotliEncoder: BrotliEncoder | null;
  terminalResponder: boolean;
}

export interface ManagedSession {
  readonly session: Session;
  readonly id: string;
  readonly createdAt: number;
  readonly clients: Set<ManagedClient>;
  // The identity this session is partitioned by (`null` = operator/legacy
  // tier, full access). Set at spawn, never mutated.
  readonly owner: SessionOwner;
  automation: AutomationContext | null;
  // ANSI-stripped PTY output accumulated for an automation shell run, stored as
  // the run's log on automation-exit. Bounded to the tail (most recent output)
  // so a long-running command's final output survives the cap.
  automationLog: string;
  outputBatch: string;
  outputBatchTimer: NodeJS.Timeout | null;
  synchronizedOutputEndDetector: SynchronizedOutputEndDetector;
  drainPollTimer: NodeJS.Timeout | null;
  gitWatcher: GitDiffWatcher;
  // Last PTY output time + whether a foreground program is running, the inputs
  // to computeState(). Mirrors the client's favicon activity tracking so the
  // session list's row color and the grace reap decision read from the same
  // "is this shell still doing something" signal.
  lastOutputAt: number;
  hasForeground: boolean;
  // The shell hook's reported foreground program name (OSC 7777 fg;<token>) or
  // null when idle — feeds keep-awake's trigger short-circuit so automatic mode
  // can match a trigger from the hook without walking `ps`.
  foregroundName: string | null;
  // No-clients grace timer: armed when the last subscriber detaches, cancelled
  // when any subscriber re-attached. On fire, re-checks activity — if the shell
  // is still doing something (output arriving, or a foreground program alive
  // though quiet) it reschedules so a dormant shell is never reaped mid-stream;
  // only a truly idle one (no recent output, no foreground program, no clients)
  // is reaped.
  graceTimer: NodeJS.Timeout | null;
  parkedAt: number | null;
  // Pinned sessions are exempt from the no-clients idle grace reap and from
  // eviction at the session cap — they live until explicitly killed or their
  // shell exits. REST-created sessions (POST /api/sessions) default to pinned
  // so an agent that spawns now and send-keys minutes later doesn't lose its
  // shell; browser tabs (spawned over the WS) are never pinned. Toggling via
  // PATCH /api/sessions/:id re-arms (or cancels) the grace timer live.
  pinned: boolean;
  // Lazily-created headless terminal for capture-pane reads. Zero cost until
  // the first capture; fed the session's live output thereafter and disposed on
  // teardown. Kept on the managed session so its lifecycle is bound to the PTY.
  captureRenderer: CaptureRenderer | undefined;
  resizeOwner: ManagedClient | null;
  // Last effective size broadcast to clients, or null before the active viewer
  // reports its dimensions. Tracked so resize activity that does not change the
  // PTY size stays quiet on the wire.
  ptySizeCols: number | null;
  ptySizeRows: number | null;
  // Whether the last resize saw more than one client. When a peer detaches and
  // leaves one viewer, a final pty-size clears any mask the peer had imposed.
  ptySizeWasMultiViewer: boolean;
}

export interface SessionManagerHooks {
  onOutputActivity: () => void;
  onSessionActivity: () => void;
  onSessionEvent: (event: SessionEventName, cwd: string) => void;
  onAutomationExit: (automationId: string, runId: string, exitCode: number, log: string) => void;
  onClientExit: (ws: ClientSocket, exitCode: number | null) => void;
}

interface SessionManagerOptions {
  hooks: SessionManagerHooks;
  sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void;
  // Live resolver for the no-clients grace window in milliseconds. Read each
  // time a grace timer arms, so a `PUT /api/config` change takes effect on the
  // next detach (and the next reschedule) without re-wiring the manager.
  // `null` = never reap. Injectable so a test can verify the reap path without
  // waiting 30s.
  getGraceMs?: () => number | null;
  // Override the pending-promote window (default SESSION_PENDING_PROMOTE_TIMEOUT_MS).
  // Injectable so a test can verify the auto-promote path (and that it still
  // sends `replay-end` so a slow client never deadlocks in its replay window)
  // without waiting the full production timeout.
  pendingPromoteTimeoutMs?: number;
  // The per-program secret shims directory, injected into every spawned Session
  // so the shell hook prepends the actual shims dir (matching where the daemon
  // generates them), not a hardcoded home path.
  shimsDir?: string;
}

// Owns every live PTY for the daemon's lifetime. A Session is created on spawn
// and stays here until its shell exits, it's explicitly killed, or its
// no-clients grace timer fires — NOT the instant its client disconnects. One
// authority (the tab that spawned it) keeps a shell alive by subscribing;
// others join alongside via the session picker. When the last subscriber
// leaves, the shell gets SESSION_GRACE_MS to be re-attached (a transient drop,
// a switch in progress) before it's reaped — so there are no zombies, but a
// shell also survives the brief disconnects that a single-WS-per-PTY model
// would kill mid-command. Any number of clients may attach to one PTY;
// output/title/cwd/foreground/exit fan out to all of them, while the most
// recently focused or interactive client owns the PTY dimensions. A slow
// receiver pauses the PTY via OS pipe backpressure instead of dropping the
// connection.
export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly lastOutputAtByPid = new Map<number, number>();
  private readonly hooks: SessionManagerHooks;
  private readonly sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void;
  private readonly outputTransport: SessionOutputTransport;
  private readonly clientHub: SessionClientHub;
  private readonly commandExecutor: SessionCommandExecutor;
  private readonly gitEventBridge: SessionGitEventBridge;
  private readonly lifecyclePolicy: SessionLifecyclePolicy;
  private readonly outputCoordinator: SessionOutputCoordinator;
  private readonly shimsDir?: string;

  constructor(options: SessionManagerOptions) {
    this.hooks = options.hooks;
    this.sendControl = options.sendControl;
    this.outputTransport = new SessionOutputTransport(options.sendControl);
    this.lifecyclePolicy = new SessionLifecyclePolicy(
      options.getGraceMs ?? (() => SESSION_GRACE_MS),
      (managed) => this.tearDown(managed),
      () => this.hooks.onSessionActivity(),
    );
    this.clientHub = new SessionClientHub({
      outputTransport: this.outputTransport,
      sendControl: this.sendControl,
      pendingPromoteTimeoutMs:
        options.pendingPromoteTimeoutMs ?? SESSION_PENDING_PROMOTE_TIMEOUT_MS,
      sessionFor: (id, owner) => this.sessionFor(id, owner),
      cancelGrace: (managed) => this.lifecyclePolicy.cancelGrace(managed),
      startGrace: (managed) => this.lifecyclePolicy.startGrace(managed),
      onSessionActivity: () => this.hooks.onSessionActivity(),
    });
    this.commandExecutor = new SessionCommandExecutor();
    this.gitEventBridge = new SessionGitEventBridge(this.clientHub, (event, cwd) =>
      this.hooks.onSessionEvent(event, cwd),
    );
    this.outputCoordinator = new SessionOutputCoordinator({
      outputTransport: this.outputTransport,
      noteOutputActivity: (pid) => this.noteOutput(pid),
      onOutputActivity: () => this.hooks.onOutputActivity(),
    });
    this.shimsDir = options.shimsDir;
  }

  size(): number {
    return this.sessions.size;
  }

  atCapacity(): boolean {
    return this.lifecyclePolicy.atCapacity(this.sessions);
  }

  // Shell pids of every live session. The keep-awake manager scopes its `ps`
  // tree walk to these so automatic mode only reacts to programs running inside
  // localterm, not anything else on the machine.
  pids(): number[] {
    return [...this.sessions.values()].map((managed) => managed.session.pid);
  }

  // Each live session's shell-hook foreground name (OSC 7777 fg;<token>), keyed
  // by the session shell's pid — fed to keep-awake so automatic mode can match a
  // trigger from the hook without walking `ps`. Excludes idle sessions (null
  // names) and, since it iterates live sessions only, prunes exited ones.
  foregroundNames(): Map<number, string> {
    const names = new Map<number, string>();
    for (const managed of this.sessions.values()) {
      if (managed.foregroundName) names.set(managed.session.pid, managed.foregroundName);
    }
    return names;
  }

  // Whether any live session currently has a second client attached — a peer
  // (a phone that ingested a share QR, or another tab via the session picker).
  // Drives keep-awake's peer trigger: automatic mode holds caffeinate while a
  // peer is present, since the machine is actively being used by someone else.
  hasPeerClient(): boolean {
    for (const managed of this.sessions.values()) {
      if (managed.clients.size >= 2) return true;
    }
    return false;
  }

  noteOutput(pid: number): void {
    this.lastOutputAtByPid.set(pid, Date.now());
  }

  hasRecentOutput(pids: readonly number[], withinMs: number): boolean {
    const cutoff = Date.now() - withinMs;
    for (const pid of pids) {
      const at = this.lastOutputAtByPid.get(pid);
      if (at !== undefined && at >= cutoff) return true;
    }
    return false;
  }

  list(owner: SessionOwner = null): SessionListItem[] {
    const all = [...this.sessions.values()];
    const scoped = owner === null ? all : all.filter((managed) => managed.owner === owner);
    return scoped.map((managed) => ({
      id: managed.id,
      pid: managed.session.pid,
      shell: managed.session.shell,
      shellName: managed.session.shellBaseName,
      cwd: managed.session.lastEmittedCwd || managed.session.cwd,
      title: managed.session.currentTitle || managed.session.initialDocumentTitle,
      createdAt: managed.createdAt,
      lastOutputAt: managed.lastOutputAt,
      clients: managed.clients.size,
      clientProfiles: this.clientHub.clientProfilesFor(managed),
      state: this.lifecyclePolicy.computeState(managed),
      pinned: managed.pinned,
    }));
  }

  workspaceEntries(): WorkspaceEntry[] {
    return this.clientHub.workspaceEntries(this.sessions.values());
  }

  clientProfile(ws: ClientSocket): { owner: SessionOwner; windowId: string } | null {
    return this.clientHub.clientProfile(ws);
  }

  attachedClientCount(owner: SessionOwner, windowId: string): number {
    return this.clientHub.attachedClientCount(this.sessions.values(), owner, windowId);
  }

  // Every live PTY whose current cwd is inside `targetPath` (or equals it). A
  // live PTY — attached, dormant (parked in the no-clients grace window), or
  // running an automation — holds the worktree as its cwd; removing the
  // worktree out from under it would break the shell, so the delete route and
  // the stale-worktree sweep both refuse a worktree with any. The current cwd
  // (lastEmittedCwd, falling back to the spawn cwd) is the signal: a shell
  // that's `cd`'d out of the worktree no longer blocks removal. Reads from
  // list() so it shares the same cwd the session picker shows.
  sessionsInPath(targetPath: string): SessionListItem[] {
    const resolvedTarget = path.resolve(targetPath);
    const prefix = `${resolvedTarget}${path.sep}`;
    return this.list().filter((session) => {
      const cwd = path.resolve(session.cwd);
      return cwd === resolvedTarget || cwd.startsWith(prefix);
    });
  }

  // Test-only: force the idle/ready state so the grace reap is eligible.
  // Pauses the PTY (a real /bin/sh keeps emitting its prompt, which would
  // reschedule the grace forever), backdates last output past the activity
  // window, and clears any foreground program, so computeState() reads "ready"
  // regardless of the foreground hook's state. Production code never
  // needs this — a live shell's actual output recency and foreground status
  // drive the reap.
  markIdleForTest(id: string): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    managed.session.pause();
    managed.lastOutputAt = 0;
    managed.hasForeground = false;
  }

  // Test-only: force output idleness (pause + backdate lastOutputAt) WITHOUT
  // clearing hasForeground, so the grace reap's foreground gate is exercised
  // against the real hook-driven foreground state instead of being masked
  // (markIdleForTest clears both, which hides a missed foreground signal).
  // Production code never needs this.
  markOutputIdleForTest(id: string): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    managed.session.pause();
    managed.lastOutputAt = 0;
  }

  // Test-only: mark a foreground program as running (or clear it) so the grace
  // reap's alive-quiet path can be exercised without racing the shell hook's
  // preexec/precmd timing (the hook emits fg;<token> on preexec and fg-idle on
  // precmd). Pair with markIdleForTest to model a quiet-but-running shell.
  // Production code never needs this.
  markForegroundForTest(id: string, running = true): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    managed.hasForeground = running;
  }

  // Test-only: emit a notification on a session as if its PTY wrote an OSC 9,
  // exercising the fan-out wiring without racing a real shell's output. Real
  // notifications come from session.ts's PTY output parser; production code
  // never needs this.
  emitNotificationForTest(id: string, body: string): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    managed.session.emit("notification", body);
  }

  spawn(
    input: SpawnPtyInput,
    automation?: AutomationContext,
    owner: SessionOwner = null,
  ): ManagedSession | null {
    if (!this.lifecyclePolicy.makeRoomForSession(this.sessions)) return null;
    const session = new Session(this.shimsDir ? { ...input, shimsDir: this.shimsDir } : input);
    const managed: ManagedSession = {
      session,
      id: session.id,
      createdAt: session.createdAt,
      clients: new Set(),
      owner,
      automation: automation ?? null,
      automationLog: "",
      outputBatch: "",
      outputBatchTimer: null,
      synchronizedOutputEndDetector: createSynchronizedOutputEndDetector(),
      drainPollTimer: null,
      gitWatcher: new GitDiffWatcher(),
      lastOutputAt: Date.now(),
      hasForeground: false,
      foregroundName: null,
      graceTimer: null,
      parkedAt: null,
      pinned: false,
      captureRenderer: undefined,
      resizeOwner: null,
      ptySizeCols: null,
      ptySizeRows: null,
      ptySizeWasMultiViewer: false,
    };
    this.sessions.set(managed.id, managed);
    this.installSessionListeners(managed);
    this.hooks.onSessionActivity();
    return managed;
  }

  // Spawn a fresh PTY and attach `ws` to it in one step. The route layer's
  // common path (a tab with no `?sid=`). Returns null only when the cap is full
  // with no dormant session to evict — the caller closes the WS with the
  // capacity code.
  spawnAndAttach(
    ws: ClientSocket,
    input: SpawnPtyInput,
    automation?: AutomationContext,
    owner: SessionOwner = null,
    windowId: string = "",
  ): ManagedSession | null {
    const spawned = this.spawn(input, automation, owner);
    if (!spawned) return null;
    return this.attach(ws, spawned.id, owner, windowId);
  }

  // Resolve a live, owned session for an id-based (REST/CLI) operation. Returns
  // null for an unknown/exited id, or when `owner` is set (multi-user mode) and
  // the session belongs to someone else — both surface as not-found to the
  // caller, so a cross-tenant probe can't enumerate or hijack. `owner === null`
  // (the operator/legacy tier) bypasses the check: full access, matching the
  // no-auth behavior exactly.
  private sessionFor(id: string, owner: SessionOwner): ManagedSession | null {
    const managed = this.sessions.get(id);
    if (!managed || managed.session.isExited) return null;
    if (owner !== null && managed.owner !== owner) return null;
    return managed;
  }

  attach(
    ws: ClientSocket,
    id: string,
    owner: SessionOwner = null,
    windowId: string = "",
  ): ManagedSession | null {
    const managed = this.clientHub.attach(ws, id, owner, windowId);
    if (managed && managed.clients.size === 1) this.gitEventBridge.startWatcher(managed);
    return managed;
  }

  async promote(ws: ClientSocket, replay: boolean, compress: CompressMode = null): Promise<void> {
    return this.clientHub.promote(ws, replay, compress);
  }

  writeInput(ws: ClientSocket, data: string): void {
    this.clientHub.writeInput(ws, data);
  }

  writeTerminalResponse(ws: ClientSocket, data: string): void {
    this.clientHub.writeTerminalResponse(ws, data);
  }

  setClientFocus(ws: ClientSocket, focused: boolean): void {
    this.clientHub.setClientFocus(ws, focused);
  }

  resize(
    ws: ClientSocket,
    cols: number,
    rows: number,
    pixelWidth?: number,
    pixelHeight?: number,
  ): void {
    this.clientHub.resize(ws, cols, rows, pixelWidth, pixelHeight);
  }

  detach(ws: ClientSocket): void {
    const managed = this.clientHub.detach(ws);
    if (managed?.clients.size === 0) this.gitEventBridge.stopWatcher(managed);
  }

  kill(id: string, owner: SessionOwner = null): boolean {
    const managed = this.sessions.get(id);
    if (!managed || (owner !== null && managed.owner !== owner)) return false;
    for (const client of managed.clients) {
      this.hooks.onClientExit(client.ws, null);
      this.sendControl(client.ws, { type: "exit", code: null });
      try {
        client.ws.close();
      } catch {
        /* already closing */
      }
    }
    this.tearDown(managed);
    this.hooks.onSessionActivity();
    return true;
  }

  disposeAll(): void {
    for (const managed of [...this.sessions.values()]) this.tearDown(managed);
    this.clientHub.dispose();
    this.lastOutputAtByPid.clear();
  }

  // Spawn a PTY with no attached WebSocket — the REST/CLI path (POST /api/sessions,
  // `localterm session new`, the one-shot exec helper). `pinned` controls the
  // idle-reap policy: a pinned session (the REST default) lives until explicitly
  // killed or its shell exits; an unpinned one enters the no-clients grace window
  // immediately (it has no viewer to detach from), matching a browser tab nobody
  // opened. Returns the session id, or null at the capacity cap.
  spawnDetached(input: SpawnPtyInput, pinned: boolean, owner: SessionOwner = null): string | null {
    const managed = this.spawn(input, undefined, owner);
    if (!managed) return null;
    managed.pinned = pinned;
    // A detached session has no client to detach from, so arm the grace now (a
    // no-op arm when pinned — startGrace parks it indefinitely instead).
    if (managed.clients.size === 0 && !managed.session.isExited) {
      this.lifecyclePolicy.startGrace(managed);
    }
    return managed.id;
  }

  // Write input to a session by id — the REST/CLI send-keys path. Unlike the
  // WebSocket `writeInput`, there's no pending-client handshake to promote; the
  // bytes go straight to the PTY. Returns false for an unknown/exited session.
  writeInputById(id: string, data: string, owner: SessionOwner = null): boolean {
    const managed = this.sessionFor(id, owner);
    if (!managed) return false;
    managed.session.write(data);
    return true;
  }

  // Resize a session by id — the REST/CLI resize path for detached sessions
  // (those with no WebSocket client to drive recomputeResize). Also keeps the
  // capture renderer's grid in sync. Returns false for an unknown/exited session.
  resizeById(id: string, cols: number, rows: number, owner: SessionOwner = null): boolean {
    const managed = this.sessionFor(id, owner);
    if (!managed) return false;
    managed.session.resize(cols, rows);
    managed.captureRenderer?.resize(cols, rows);
    return true;
  }

  // Read the session's rendered screen as clean text (ANSI processed by the
  // headless emulator) — the tmux `capture-pane -p` equivalent. `lines` defaults
  // to the visible viewport and may extend into scrollback up to
  // CAPTURE_PANE_MAX_LINES. Returns null for an unknown/exited session. Awaits
  // the renderer's pending writes so the read never lands before a parse.
  async capturePane(
    id: string,
    lines?: number,
    owner: SessionOwner = null,
  ): Promise<string | null> {
    const managed = this.sessionFor(id, owner);
    if (!managed) return null;
    return this.commandExecutor.capturePane(managed, lines);
  }

  // Toggle a session's pinned flag — PATCH /api/sessions/:id. Re-arms (or
  // cancels) the grace timer live for a dormant session so the change takes
  // effect immediately, not on the next detach. Returns false for an unknown id.
  setPinned(id: string, pinned: boolean, owner: SessionOwner = null): boolean {
    const managed = this.sessions.get(id);
    if (!managed || (owner !== null && managed.owner !== owner)) return false;
    managed.pinned = pinned;
    if (managed.clients.size === 0 && !managed.session.isExited) {
      this.lifecyclePolicy.startGrace(managed);
    }
    return true;
  }

  // Rename a session — PATCH /api/sessions/:id. The shell's next OSC title or
  // cwd-derived title overwrites it (as in tmux), but until then the picker and a
  // fresh attach see the renamed title. Returns false for an unknown id.
  setTitleById(id: string, title: string, owner: SessionOwner = null): boolean {
    const managed = this.sessions.get(id);
    if (!managed || (owner !== null && managed.owner !== owner)) return false;
    managed.session.setTitle(title);
    return true;
  }

  // Resolve space-separated named keys (`F2`, `Escape`, `Ctrl-C`, literal text)
  // to xterm bytes and write them to a session — the `localterm session press`
  // path. Unknown tokens pass through as literal text so `press hello` types
  // "hello". Returns false for an unknown/exited session.
  pressKeysById(id: string, input: string, owner: SessionOwner = null): boolean {
    const managed = this.sessionFor(id, owner);
    if (!managed) return false;
    const data = resolveNamedKeys(input);
    if (!data) return false;
    managed.session.write(data);
    return true;
  }

  // Wait primitive: block until the session's rendered pane matches a text /
  // regex predicate or goes idle for `idleMs`, bounded by `timeoutMs`. Reuses
  // the tmux-parity capture renderer (flushed per frame) as the source of
  // truth — the same grid `capture-pane` and `exec` read — so the predicate
  // tests clean, ANSI-processed text, not raw bytes. Resolves `{matched,
  // elapsedMs, snapshot}`. Returns null for an unknown/exited session.
  async waitFor(
    id: string,
    predicate: WaitPredicate,
    timeoutMs: number,
    idleMs?: number,
    owner: SessionOwner = null,
  ): Promise<WaitResult | null> {
    const managed = this.sessionFor(id, owner);
    if (!managed) return null;
    return this.commandExecutor.waitFor(managed, predicate, timeoutMs, idleMs);
  }

  // Resolve the (col, row) of a label on the session's visible viewport — the
  // `mouse --on-text` coord source. Reads the capture renderer's grid (the same
  // source `capture-pane` uses) so no browser tab is required to find the label.
  // Returns null when the text isn't on screen.
  async findTextInViewport(
    id: string,
    needle: string,
    owner: SessionOwner = null,
  ): Promise<{ col: number; row: number } | null> {
    const managed = this.sessionFor(id, owner);
    if (!managed) return null;
    return this.commandExecutor.findTextInViewport(managed, needle);
  }

  // Whether the session's foreground app enabled a mouse tracking mode — gates
  // the SGR-1006 fallback for `mouse` when no CDP tab is available.
  mouseEnabledFor(id: string, owner: SessionOwner = null): boolean {
    const managed = this.sessions.get(id);
    if (!managed || (owner !== null && managed.owner !== owner)) return false;
    return managed.session.mouseEnabled;
  }

  // The session's current PTY size (cols/rows), for the mouse-state endpoint
  // and any coord-bounds check. Returns `{0,0}` for an unknown id.
  sessionSizeFor(id: string, owner: SessionOwner = null): { cols: number; rows: number } {
    const managed = this.sessions.get(id);
    if (!managed || (owner !== null && managed.owner !== owner)) return { cols: 0, rows: 0 };
    return { cols: managed.session.cols, rows: managed.session.rows };
  }

  // Run a single shell command line inside a persistent session, capture its
  // rendered output, and return its exit code — the blocking tmux send-keys +
  // capture-pane replacement for agents. The command and its completion marker
  // are written on ONE input line (`;`-chained) so `$?` is the command's exit
  // before the next prompt's precmd hooks reset it. A start/end marker pair
  // brackets the output in the rendered grid; the marker lines themselves are
  // stripped. A timeout interrupts a hung command (Ctrl-C) and returns partial
  // output. `command` must be a single line — for multi-line logic, write a
  // script and exec `bash script.sh`.
  async execInSession(
    id: string,
    command: string,
    options: ExecOptions = {},
    owner: SessionOwner = null,
  ): Promise<ExecResult | null> {
    const managed = this.sessionFor(id, owner);
    if (!managed) return null;
    return this.commandExecutor.execute(managed, command, options);
  }

  private installSessionListeners(managed: ManagedSession): void {
    const session = managed.session;
    session.on("output", (data: string) => this.outputCoordinator.onSessionOutput(managed, data));
    session.on("title", (title: string) =>
      this.outputTransport.broadcast(managed, { type: "title", title }),
    );
    session.on("cwd", (cwd: string) => {
      this.outputTransport.broadcast(managed, { type: "cwd", cwd });
      this.gitEventBridge.handleCwdChange(managed, cwd);
    });
    session.on("foreground", (process: string | null) => {
      managed.hasForeground = process !== null;
      managed.foregroundName = process;
      this.outputTransport.broadcast(managed, { type: "foreground", process });
      this.hooks.onSessionActivity();
      if (!managed.automation && session.lastEmittedCwd) {
        this.hooks.onSessionEvent("foreground", session.lastEmittedCwd);
      }
    });
    session.on("notification", (body: string) => {
      // Fan out across the owner's tabs, not just this session's viewers: a
      // user who stepped away to another session still gets the ping. `hasViewers`
      // lets each receiving tab suppress the notification when the session is
      // already viewed in another browser profile, and tells the SW's click
      // handler whether to open a fresh tab (orphaned) or not (avoid a duplicate).
      this.clientHub.broadcastToOwner(managed, {
        type: "notification",
        sessionId: managed.id,
        body,
        hasViewers: managed.clients.size > 0,
      });
      if (!managed.automation && session.lastEmittedCwd) {
        this.hooks.onSessionEvent("notification", session.lastEmittedCwd);
      }
    });
    this.gitEventBridge.installSessionListener(managed);
    session.on("exit", (code: number | null) => this.handleExit(managed, code));
    const automation = managed.automation;
    if (automation) {
      session.on("automation-exit", (exitCode: number) =>
        this.hooks.onAutomationExit(
          automation.automationId,
          automation.runId,
          exitCode,
          managed.automationLog,
        ),
      );
    }
    this.gitEventBridge.installWatcherListeners(managed);
  }

  private handleExit(managed: ManagedSession, code: number | null): void {
    this.outputCoordinator.flushOutput(managed);
    for (const client of managed.clients) {
      this.hooks.onClientExit(client.ws, code);
      this.sendControl(client.ws, { type: "exit", code });
      try {
        client.ws.close();
      } catch {
        /* already closing */
      }
    }
    if (!managed.automation && managed.session.lastEmittedCwd) {
      this.hooks.onSessionEvent("exit", managed.session.lastEmittedCwd);
    }
    this.tearDown(managed);
    this.hooks.onSessionActivity();
  }

  private tearDown(managed: ManagedSession): void {
    this.lifecyclePolicy.cancelGrace(managed);
    managed.captureRenderer?.dispose();
    managed.captureRenderer = undefined;
    deletePasteImagesForSession(managed.id);
    if (managed.outputBatchTimer !== null) {
      clearTimeout(managed.outputBatchTimer);
      managed.outputBatchTimer = null;
    }
    this.outputCoordinator.stopDrainPoll(managed);
    this.gitEventBridge.dispose(managed);
    this.clientHub.tearDown(managed);
    this.sessions.delete(managed.id);
    this.lastOutputAtByPid.delete(managed.session.pid);
    try {
      managed.session.dispose();
    } catch {
      /* already torn down */
    }
  }

  // Re-arm every parked session's grace timer with the current grace value.
  // Called after a `PUT /api/config` grace change so it takes effect on shells
  // that are already dormant, not only the next detach: a finite value arms (or
  // resets) their timers, and `null` cancels them so they park indefinitely.
  rearmGrace(): void {
    this.lifecyclePolicy.rearmGrace(this.sessions);
  }

  broadcastGitBranchPr(cwd: string, pr: GitBranchPr | null): void {
    this.gitEventBridge.broadcastGitBranchPr(cwd, pr);
  }

  hasCoordinatorFor(cwd: string): boolean {
    return this.gitEventBridge.hasCoordinatorFor(cwd);
  }
}

export interface SessionListItem {
  id: string;
  pid: number;
  shell: string;
  shellName: string;
  cwd: string;
  title: string;
  createdAt: number;
  lastOutputAt: number;
  clients: number;
  clientProfiles?: SessionClientProfile[];
  state: SessionActivityState;
  pinned: boolean;
}
