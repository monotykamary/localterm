import path from "node:path";
import {
  MAX_CONCURRENT_SESSIONS,
  MAX_OUTPUT_BYTES,
  OUTPUT_BATCH_FLUSH_BYTES,
  OUTPUT_BATCH_WINDOW_MS,
  SESSION_ACTIVITY_WINDOW_MS,
  SESSION_GRACE_MS,
  SESSION_PENDING_PROMOTE_TIMEOUT_MS,
  WS_BACKPRESSURE_THRESHOLD_BYTES,
  WS_CLOSE_BACKPRESSURE,
  WS_OUTBOUND_DRAIN_POLL_MS,
  WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES,
  WS_OUTBOUND_RESUME_LOW_WATER_BYTES,
  WS_READY_STATE_OPEN,
} from "./constants.js";
import {
  GitDiffWatcher,
  GIT_DIFF_WATCHER_EVENT_NAMES,
  type GitRefEventName,
} from "./git-diff-watcher.js";
import { GitDirtyCoordinator } from "./git-dirty-coordinator.js";
import { Session } from "./session.js";
import type { SessionEventName } from "./session-event-manager.js";
import type { ServerToClientMessage, SpawnPtyInput } from "./types.js";
import { getBufferedAmount, type ClientSocket } from "./utils/ws-socket.js";

export interface AutomationContext {
  automationId: string;
  runId: string;
}

// Favicon-equivalent activity state, computed server-side from output recency
// and foreground status. "running" = output within SESSION_ACTIVITY_WINDOW_MS
// (the tab favicon turns green); "alive-quiet" = a foreground program is still
// running but output has gone quiet (the favicon turns blue); "ready" = idle at
// the shell prompt (the favicon turns grey). Surfaced on the session list so a
// glance shows what's actively producing vs waiting, and gates the grace reap
// so a quiet-but-running shell isn't reaped.
export type SessionActivityState = "running" | "alive-quiet" | "ready";

interface ManagedClient {
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
  pixelWidth?: number;
  pixelHeight?: number;
  coordinator: GitDirtyCoordinator | null;
}

export interface ManagedSession {
  readonly session: Session;
  readonly id: string;
  readonly createdAt: number;
  readonly clients: Set<ManagedClient>;
  automation: AutomationContext | null;
  outputBatch: string;
  outputBatchTimer: NodeJS.Timeout | null;
  drainPollTimer: NodeJS.Timeout | null;
  gitWatcher: GitDiffWatcher;
  // Last PTY output time + whether a foreground program is running, the inputs
  // to computeState(). Mirrors the client's favicon activity tracking so the
  // session list's row color and the grace reap decision read from the same
  // "is this shell still doing something" signal.
  lastOutputAt: number;
  hasForeground: boolean;
  // No-clients grace timer: armed when the last subscriber detaches, cancelled
  // when any subscriber re-attaches. On fire, re-checks activity — if the shell
  // is still doing something (output arriving, or a foreground program alive
  // though quiet) it reschedules so a dormant shell is never reaped mid-stream;
  // only a truly idle one (no recent output, no foreground program, no clients)
  // is reaped.
  graceTimer: NodeJS.Timeout | null;
  parkedAt: number | null;
}

export interface SessionManagerHooks {
  onOutputActivity: () => void;
  onSessionActivity: () => void;
  onSessionEvent: (event: SessionEventName, cwd: string) => void;
  onAutomationExit: (automationId: string, runId: string, exitCode: number) => void;
  onClientExit: (ws: ClientSocket, exitCode: number | null) => void;
}

interface SessionManagerOptions {
  hooks: SessionManagerHooks;
  sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void;
  // Override the no-clients grace window (default SESSION_GRACE_MS). Injectable
  // so a test can verify the reap path without waiting 30s.
  graceMs?: number;
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
// output/title/cwd/foreground/exit fan out to all of them, resize is the min
// dimensions across attached clients (tmux style, so two clients of different
// sizes don't fight), and a slow receiver pauses the PTY via OS pipe
// backpressure instead of dropping the connection.
export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly wsToClient = new Map<
    ClientSocket,
    { client: ManagedClient; session: ManagedSession }
  >();
  private readonly lastOutputAtByPid = new Map<number, number>();
  private readonly coordinatorsByCwd = new Map<string, GitDirtyCoordinator>();
  private readonly hooks: SessionManagerHooks;
  private readonly sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void;
  private readonly graceMs: number;

  constructor(options: SessionManagerOptions) {
    this.hooks = options.hooks;
    this.sendControl = options.sendControl;
    this.graceMs = options.graceMs ?? SESSION_GRACE_MS;
  }

  size(): number {
    return this.sessions.size;
  }

  atCapacity(): boolean {
    if (this.sessions.size < MAX_CONCURRENT_SESSIONS) return false;
    for (const managed of this.sessions.values()) {
      if (managed.clients.size === 0) return false;
    }
    return true;
  }

  // Shell pids of every live session. The keep-awake manager scopes its `ps`
  // tree walk to these so automatic mode only reacts to programs running inside
  // localterm, not anything else on the machine.
  pids(): number[] {
    return [...this.sessions.values()].map((managed) => managed.session.pid);
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

  list(): SessionListItem[] {
    return [...this.sessions.values()].map((managed) => ({
      id: managed.id,
      pid: managed.session.pid,
      shell: managed.session.shell,
      shellName: managed.session.shellBaseName,
      cwd: managed.session.lastEmittedCwd || managed.session.cwd,
      title: managed.session.currentTitle || managed.session.initialDocumentTitle,
      createdAt: managed.createdAt,
      lastOutputAt: managed.lastOutputAt,
      clients: managed.clients.size,
      state: this.computeState(managed),
    }));
  }

  // Test-only: force the idle/ready state so the grace reap is eligible.
  // Pauses the PTY (a real /bin/sh keeps emitting its prompt, which would
  // reschedule the grace forever), backdates last output past the activity
  // window, and clears any foreground program, so computeState() reads "ready"
  // regardless of what the foreground watcher reports. Production code never
  // needs this — a live shell's actual output recency and foreground status
  // drive the reap.
  markIdleForTest(id: string): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    managed.session.pause();
    managed.lastOutputAt = 0;
    managed.hasForeground = false;
  }

  // Test-only: mark a foreground program as running (or clear it) so the grace
  // reap's alive-quiet path can be exercised without racing a real shell's
  // process-group introspection (pty.process is transient during spawn and
  // load-sensitive). Pair with markIdleForTest to model a quiet-but-running
  // shell. Production code never needs this.
  markForegroundForTest(id: string, running = true): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    managed.hasForeground = running;
  }

  spawn(input: SpawnPtyInput, automation?: AutomationContext): ManagedSession | null {
    if (this.sessions.size >= MAX_CONCURRENT_SESSIONS) this.evictOldestDormant();
    if (this.sessions.size >= MAX_CONCURRENT_SESSIONS) return null;
    const session = new Session(input);
    const managed: ManagedSession = {
      session,
      id: session.id,
      createdAt: session.createdAt,
      clients: new Set(),
      automation: automation ?? null,
      outputBatch: "",
      outputBatchTimer: null,
      drainPollTimer: null,
      gitWatcher: new GitDiffWatcher(),
      lastOutputAt: Date.now(),
      hasForeground: false,
      graceTimer: null,
      parkedAt: null,
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
  ): ManagedSession | null {
    const spawned = this.spawn(input, automation);
    if (!spawned) return null;
    return this.attach(ws, spawned.id);
  }

  // Attach `ws` to a live PTY by id. Returns the session to reattach to, or
  // null when the id is unknown / already exited — the caller spawns fresh.
  attach(ws: ClientSocket, id: string): ManagedSession | null {
    const managed = this.sessions.get(id);
    if (!managed || managed.session.isExited) return null;
    // Re-subscribing cancels the no-clients grace timer (if armed): the shell
    // has a viewer again, so it stays alive.
    this.cancelGrace(managed);
    const coordinator = this.coordinatorForCwd(managed.session.cwd);
    const client: ManagedClient = {
      ws,
      pending: true,
      pendingControl: [],
      pendingBytes: [],
      pendingTimer: null,
      cols: 0,
      rows: 0,
      coordinator,
    };
    coordinator.add(ws);
    managed.clients.add(client);
    this.wsToClient.set(ws, { client, session: managed });
    this.recomputeResize(managed);
    // Auto-promote a client that never sends {type:"ready"} — a back-compat
    // client (an older bundled terminal, or any plain WS reader) would otherwise
    // stay pending and never receive output. The localterm client sends ready
    // within milliseconds of the session frame, well before this fires, so its
    // scrollback replay still lands first.
    client.pendingTimer = setTimeout(
      () => this.promote(ws, false),
      SESSION_PENDING_PROMOTE_TIMEOUT_MS,
    );
    client.pendingTimer.unref?.();
    this.hooks.onSessionActivity();
    return managed;
  }

  // Promote a pending client to live fan-out. Idempotent (a no-op once the
  // client is already live), so the pending timeout and an explicit {ready}
  // can race safely. When `replay` is true the session's scrollback ring
  // buffer is sent as one binary frame first, then the control messages and
  // output bytes buffered while pending flush in order — so a tab switching
  // to this PTY lands on recent output instead of a blank screen, with no
  // live frame interleaving between replay and the buffered fan-out.
  promote(ws: ClientSocket, replay: boolean): void {
    const entry = this.wsToClient.get(ws);
    if (!entry) return;
    const client = entry.client;
    if (!client.pending) return;
    if (client.pendingTimer !== null) {
      clearTimeout(client.pendingTimer);
      client.pendingTimer = null;
    }
    if (replay) {
      this.sendScrollback(ws, entry.session);
      // Tell the client the replay bytes have all landed so it can write them as
      // one suppressed block (dropping xterm's responses to the stale query
      // requests in the ring buffer). Sent even when the snapshot was empty so
      // the client always exits its suppressed-replay window.
      this.sendControl(ws, { type: "replay-end" });
    }
    for (const payload of client.pendingControl) this.sendControl(ws, payload);
    for (const bytes of client.pendingBytes) this.sendOutputBytes(ws, bytes);
    client.pendingControl = [];
    client.pendingBytes = [];
    client.pending = false;
  }

  writeInput(ws: ClientSocket, data: string): void {
    const entry = this.wsToClient.get(ws);
    if (!entry) return;
    // A client sending input is clearly live and wants output. Promote it out
    // of the pending hold without a scrollback replay — a back-compat client
    // that never sends {type:"ready"} still unblocks on its first keystroke.
    // The localterm client sends {type:"ready"} before any input, so this is a
    // no-op for it. Promote flushes any buffered output before the input echoes.
    if (entry.client.pending) this.promote(ws, false);
    entry.session.session.write(data);
  }

  resize(
    ws: ClientSocket,
    cols: number,
    rows: number,
    pixelWidth?: number,
    pixelHeight?: number,
  ): void {
    const entry = this.wsToClient.get(ws);
    if (!entry) return;
    entry.client.cols = cols;
    entry.client.rows = rows;
    entry.client.pixelWidth = pixelWidth;
    entry.client.pixelHeight = pixelHeight;
    this.recomputeResize(entry.session);
  }

  // Detach a single client. If this was the last subscriber, arm the
  // no-clients grace timer: the PTY stays alive for SESSION_GRACE_MS so a
  // transient drop or a switch can re-attach, then is reaped if nobody does.
  detach(ws: ClientSocket): void {
    const entry = this.wsToClient.get(ws);
    if (!entry) return;
    this.wsToClient.delete(ws);
    const managed = entry.session;
    const client = entry.client;
    if (client.pendingTimer !== null) {
      clearTimeout(client.pendingTimer);
      client.pendingTimer = null;
    }
    client.pendingControl = [];
    client.pendingBytes = [];
    if (client.coordinator) {
      client.coordinator.remove(ws);
      this.releaseCoordinator(client.coordinator);
    }
    managed.clients.delete(client);
    this.recomputeResize(managed);
    if (managed.clients.size === 0 && !managed.session.isExited) this.startGrace(managed);
    this.hooks.onSessionActivity();
  }

  kill(id: string): boolean {
    const managed = this.sessions.get(id);
    if (!managed) return false;
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
    this.coordinatorsByCwd.clear();
    this.lastOutputAtByPid.clear();
  }

  private sendScrollback(ws: ClientSocket, managed: ManagedSession): void {
    const snapshot = managed.session.snapshotScrollback();
    if (!snapshot) return;
    const bytes = Buffer.from(snapshot, "utf8");
    if (bytes.byteLength <= MAX_OUTPUT_BYTES) {
      this.sendOutputBytes(ws, bytes);
      return;
    }
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_OUTPUT_BYTES) {
      this.sendOutputBytes(ws, bytes.subarray(offset, offset + MAX_OUTPUT_BYTES));
    }
  }

  private sendOutputBytes(ws: ClientSocket, bytes: Uint8Array<ArrayBuffer>): void {
    if (ws.readyState !== WS_READY_STATE_OPEN) return;
    if (getBufferedAmount(ws) > WS_BACKPRESSURE_THRESHOLD_BYTES) {
      ws.close(WS_CLOSE_BACKPRESSURE, "backpressure");
      return;
    }
    try {
      ws.send(bytes);
    } catch {
      /* socket closed between readyState check and send */
    }
  }

  private broadcastBytes(managed: ManagedSession, bytes: Uint8Array<ArrayBuffer>): void {
    for (const client of managed.clients) {
      if (client.pending) {
        client.pendingBytes.push(bytes);
        continue;
      }
      this.sendOutputBytes(client.ws, bytes);
    }
  }

  private broadcast(managed: ManagedSession, payload: ServerToClientMessage): void {
    for (const client of managed.clients) {
      if (client.pending) {
        client.pendingControl.push(payload);
        continue;
      }
      this.sendControl(client.ws, payload);
    }
  }

  private onSessionOutput(managed: ManagedSession, data: string): void {
    managed.outputBatch += data;
    managed.lastOutputAt = Date.now();
    this.noteOutput(managed.session.pid);
    this.hooks.onOutputActivity();
    if (managed.outputBatch.length >= OUTPUT_BATCH_FLUSH_BYTES) {
      if (managed.outputBatchTimer !== null) {
        clearTimeout(managed.outputBatchTimer);
        managed.outputBatchTimer = null;
      }
      this.flushOutput(managed);
    } else if (managed.outputBatchTimer === null) {
      managed.outputBatchTimer = setTimeout(() => {
        managed.outputBatchTimer = null;
        this.flushOutput(managed);
      }, OUTPUT_BATCH_WINDOW_MS);
      managed.outputBatchTimer.unref?.();
    }
  }

  private flushOutput(managed: ManagedSession): void {
    const batch = managed.outputBatch;
    managed.outputBatch = "";
    if (!batch) return;
    const bytes = Buffer.from(batch, "utf8");
    if (bytes.byteLength <= MAX_OUTPUT_BYTES) {
      this.broadcastBytes(managed, bytes);
    } else {
      for (let offset = 0; offset < bytes.byteLength; offset += MAX_OUTPUT_BYTES) {
        this.broadcastBytes(managed, bytes.subarray(offset, offset + MAX_OUTPUT_BYTES));
      }
    }
    this.maybePauseAfterFlush(managed);
  }

  private maybePauseAfterFlush(managed: ManagedSession): void {
    if (managed.session.isPaused) return;
    for (const client of managed.clients) {
      if (client.pending) continue;
      if (getBufferedAmount(client.ws) >= WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES) {
        managed.session.pause();
        this.ensureDrainPoll(managed);
        return;
      }
    }
  }

  private ensureDrainPoll(managed: ManagedSession): void {
    if (managed.drainPollTimer !== null) return;
    managed.drainPollTimer = setInterval(() => {
      if (!managed.session.isPaused) {
        this.stopDrainPoll(managed);
        return;
      }
      let allLow = true;
      for (const client of managed.clients) {
        if (client.pending) continue;
        if (getBufferedAmount(client.ws) > WS_OUTBOUND_RESUME_LOW_WATER_BYTES) {
          allLow = false;
          break;
        }
      }
      if (allLow) {
        managed.session.resume();
        this.stopDrainPoll(managed);
      }
    }, WS_OUTBOUND_DRAIN_POLL_MS);
    managed.drainPollTimer.unref?.();
  }

  private stopDrainPoll(managed: ManagedSession): void {
    if (managed.drainPollTimer === null) return;
    clearInterval(managed.drainPollTimer);
    managed.drainPollTimer = null;
  }

  private recomputeResize(managed: ManagedSession): void {
    const session = managed.session;
    if (session.isExited) return;
    let cols = Infinity;
    let rows = Infinity;
    let single: ManagedClient | null = null;
    let count = 0;
    for (const client of managed.clients) {
      count++;
      single = client;
      if (client.cols > 0 && client.cols < cols) cols = client.cols;
      if (client.rows > 0 && client.rows < rows) rows = client.rows;
    }
    if (count === 0) return;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    if (count === 1 && single?.pixelWidth !== undefined && single?.pixelHeight !== undefined) {
      session.resize(cols, rows, single.pixelWidth, single.pixelHeight);
    } else {
      session.resize(cols, rows);
    }
  }

  private installSessionListeners(managed: ManagedSession): void {
    const session = managed.session;
    session.on("output", (data: string) => this.onSessionOutput(managed, data));
    session.on("title", (title: string) => this.broadcast(managed, { type: "title", title }));
    session.on("cwd", (cwd: string) => {
      this.broadcast(managed, { type: "cwd", cwd });
      managed.gitWatcher.stop();
      managed.gitWatcher.start(cwd);
      for (const client of managed.clients) this.moveClientCoordinator(client, cwd);
      if (!managed.automation) this.hooks.onSessionEvent("cwd", cwd);
    });
    session.on("foreground", (process: string | null) => {
      managed.hasForeground = process !== null;
      this.broadcast(managed, { type: "foreground", process });
      this.hooks.onSessionActivity();
      if (!managed.automation && session.lastEmittedCwd) {
        this.hooks.onSessionEvent("foreground", session.lastEmittedCwd);
      }
    });
    session.on("notification", (body: string) => {
      this.broadcast(managed, { type: "notification", body });
      if (!managed.automation && session.lastEmittedCwd) {
        this.hooks.onSessionEvent("notification", session.lastEmittedCwd);
      }
    });
    session.on("git-dirty", () => {
      const cwd = session.lastEmittedCwd;
      if (cwd) this.coordinatorForCwd(cwd).signal();
      if (!managed.automation && cwd) this.hooks.onSessionEvent("git-dirty", cwd);
    });
    session.on("exit", (code: number | null) => this.handleExit(managed, code));
    const automation = managed.automation;
    if (automation) {
      session.on("automation-exit", (exitCode: number) =>
        this.hooks.onAutomationExit(automation.automationId, automation.runId, exitCode),
      );
    }
    managed.gitWatcher.on("git-dirty", () => {
      const cwd = session.lastEmittedCwd;
      if (cwd) this.coordinatorForCwd(cwd).signal();
    });
    for (const refEvent of GIT_DIFF_WATCHER_EVENT_NAMES) {
      if (refEvent === "git-dirty") continue;
      const eventName: GitRefEventName = refEvent;
      managed.gitWatcher.on(eventName, () => {
        if (!managed.automation && session.lastEmittedCwd) {
          this.hooks.onSessionEvent(eventName, session.lastEmittedCwd);
        }
      });
    }
    managed.gitWatcher.start(session.cwd);
  }

  private moveClientCoordinator(client: ManagedClient, cwd: string): void {
    const next = this.coordinatorForCwd(cwd);
    if (client.coordinator === next) return;
    if (client.coordinator) {
      client.coordinator.remove(client.ws);
      this.releaseCoordinator(client.coordinator);
    }
    client.coordinator = next;
    next.add(client.ws);
  }

  private handleExit(managed: ManagedSession, code: number | null): void {
    this.flushOutput(managed);
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
    if (managed.graceTimer !== null) {
      clearTimeout(managed.graceTimer);
      managed.graceTimer = null;
    }
    managed.parkedAt = null;
    if (managed.outputBatchTimer !== null) {
      clearTimeout(managed.outputBatchTimer);
      managed.outputBatchTimer = null;
    }
    this.stopDrainPoll(managed);
    managed.gitWatcher.dispose();
    for (const client of managed.clients) {
      if (client.pendingTimer !== null) {
        clearTimeout(client.pendingTimer);
        client.pendingTimer = null;
      }
      client.pendingControl = [];
      client.pendingBytes = [];
      if (client.coordinator) {
        client.coordinator.remove(client.ws);
        this.releaseCoordinator(client.coordinator);
      }
      this.wsToClient.delete(client.ws);
    }
    managed.clients.clear();
    this.sessions.delete(managed.id);
    this.lastOutputAtByPid.delete(managed.session.pid);
    try {
      managed.session.dispose();
    } catch {
      /* already torn down */
    }
  }

  private evictOldestDormant(): void {
    let oldest: ManagedSession | null = null;
    let oldestKey = Infinity;
    for (const managed of this.sessions.values()) {
      if (managed.clients.size > 0) continue;
      // Evict the parked session whose grace fires soonest (armed earliest); a
      // parked session with no timer is a fresh spawn nobody attached yet —
      // yield it only after all armed ones.
      const key = managed.parkedAt ?? managed.createdAt;
      if (key < oldestKey) {
        oldestKey = key;
        oldest = managed;
      }
    }
    if (oldest) this.tearDown(oldest);
  }

  private startGrace(managed: ManagedSession): void {
    this.cancelGrace(managed);
    managed.parkedAt = Date.now();
    managed.graceTimer = setTimeout(() => {
      managed.graceTimer = null;
      managed.parkedAt = null;
      // Re-check on fire: reschedule while the shell is still doing something —
      // output still arriving (running), or a foreground program still alive
      // though quiet (alive-quiet) — so a closed tab never kills a running
      // command mid-stream, even after it's gone quiet. The shell only dies on
      // a real idle (ready: no recent output and no foreground program, no
      // clients), the same "no activity" signal that turns the tab's favicon
      // grey.
      if (this.computeState(managed) !== "ready") {
        this.startGrace(managed);
        return;
      }
      this.tearDown(managed);
      this.hooks.onSessionActivity();
    }, this.graceMs);
    managed.graceTimer.unref?.();
  }

  private cancelGrace(managed: ManagedSession): void {
    if (managed.graceTimer !== null) {
      clearTimeout(managed.graceTimer);
      managed.graceTimer = null;
    }
    managed.parkedAt = null;
  }

  // The favicon-equivalent state, computed from the same signals the client's
  // favicon uses (recent output → running; a foreground program but quiet →
  // alive-quiet; idle → ready). Surfaced on the session list so the row icon
  // colors match the tab the user is looking at.
  private computeState(managed: ManagedSession): SessionActivityState {
    if (Date.now() - managed.lastOutputAt < SESSION_ACTIVITY_WINDOW_MS) return "running";
    return managed.hasForeground ? "alive-quiet" : "ready";
  }

  private coordinatorForCwd(cwd: string): GitDirtyCoordinator {
    const key = path.resolve(cwd);
    let coordinator = this.coordinatorsByCwd.get(key);
    if (!coordinator) {
      coordinator = new GitDirtyCoordinator(key, this.sendControl);
      this.coordinatorsByCwd.set(key, coordinator);
    }
    return coordinator;
  }

  private releaseCoordinator(coordinator: GitDirtyCoordinator): void {
    if (coordinator.isEmpty) this.coordinatorsByCwd.delete(coordinator.cwd);
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
  state: SessionActivityState;
}
