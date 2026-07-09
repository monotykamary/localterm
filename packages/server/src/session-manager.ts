import { randomBytes } from "node:crypto";
import path from "node:path";
import zlib from "node:zlib";
import { CaptureRenderer } from "./capture-renderer.js";
import {
  CAPTURE_PANE_MAX_LINES,
  EXEC_DEFAULT_OUTPUT_LIMIT_BYTES,
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_EPHEMERAL_SCROLLBACK,
  EXEC_MAX_OUTPUT_LIMIT_BYTES,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_RAW_ACCUMULATE_CAP_BYTES,
  EXEC_TIMEOUT_INTERRUPT_GRACE_MS,
  MAX_AUTOMATION_LOG_LENGTH,
  MAX_CONCURRENT_SESSIONS,
  MAX_OUTPUT_BYTES,
  OUTPUT_BATCH_FLUSH_BYTES,
  OUTPUT_BATCH_WINDOW_MS,
  SESSION_ACTIVITY_WINDOW_MS,
  SESSION_GRACE_MS,
  SESSION_PENDING_PROMOTE_TIMEOUT_MS,
  WAIT_IDLE_POLL_INTERVAL_MS,
  WS_BACKPRESSURE_THRESHOLD_BYTES,
  WS_CLOSE_BACKPRESSURE,
  WS_OUTBOUND_DRAIN_POLL_MS,
  WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES,
  WS_OUTBOUND_RESUME_LOW_WATER_BYTES,
  WS_READY_STATE_OPEN,
  WS_OUTPUT_BROTLI,
  WS_OUTPUT_BROTLI_CTX,
  WS_OUTPUT_BROTLI_QUALITY,
  WS_OUTPUT_COMPRESS_THRESHOLD_BYTES,
  WS_OUTPUT_CTX_HEADER_BYTES,
  WS_OUTPUT_GZIP,
  WS_OUTPUT_GZIP_LEVEL,
  WS_OUTPUT_RAW,
} from "./constants.js";
import {
  GitDiffWatcher,
  GIT_DIFF_WATCHER_EVENT_NAMES,
  type GitRefEventName,
} from "./git-diff-watcher.js";
import { GitMetadataCoordinator } from "./git-metadata-coordinator.js";
import { Session } from "./session.js";
import type { SessionEventName } from "./session-event-manager.js";
import type {
  GitBranchPr,
  ServerToClientMessage,
  SessionClientProfile,
  SpawnPtyInput,
} from "./types.js";
import type { CompressMode } from "./schemas.js";
import type { SessionOwner } from "./identity/types.js";

// Persistent Brotli compressor for the context-takeover mode ("br-ctx"). Each
// output frame is flushed as a chunk of ONE continuous Brotli stream, so frame N
// compresses against frames 0..N-1 (the prior screen primes the LZ77 window —
// the delta). Per-client, created on promote, released on detach. The flushes
// are chained (a per-encoder FIFO) so frames compress + ship in PTY order even
// though each flush is async (the BROTLI_OPERATION_FLUSH callback fires on the
// next tick). The accumulator is trimmed after each flush so a long session
// doesn't grow without bound.
interface BrotliEncoder {
  flush: (bytes: Uint8Array<ArrayBuffer>) => Promise<Buffer<ArrayBuffer>>;
  release: () => void;
}
const makeBrotliEncoder = (level: number): BrotliEncoder => {
  const enc = zlib.createBrotliCompress({
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level },
  });
  let buf = Buffer.alloc(0);
  enc.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
  });
  let chain: Promise<Buffer<ArrayBuffer>> = Promise.resolve(Buffer.alloc(0));
  const flush = (bytes: Uint8Array<ArrayBuffer>): Promise<Buffer<ArrayBuffer>> => {
    chain = chain.then(
      () =>
        new Promise<Buffer<ArrayBuffer>>((resolve) => {
          const before = buf.length;
          enc.write(bytes);
          enc.flush(zlib.constants.BROTLI_OPERATION_FLUSH, () => {
            setImmediate(() => {
              const out = buf.subarray(before, buf.length);
              buf = buf.subarray(buf.length);
              resolve(out);
            });
          });
        }),
    );
    return chain;
  };
  const release = () => {
    try {
      enc.destroy();
    } catch {
      /* already closed */
    }
  };
  return { flush, release };
};
import { resolveNamedKeys } from "./utils/named-keys.js";
import { stripAnsi } from "./utils/strip-ansi.js";
import { getBufferedAmount, type ClientSocket } from "./utils/ws-socket.js";

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
  drainPollTimer: NodeJS.Timeout | null;
  gitWatcher: GitDiffWatcher;
  // Last PTY output time + whether a foreground program is running, the inputs
  // to computeState(). Mirrors the client's favicon activity tracking so the
  // session list's row color and the grace reap decision read from the same
  // "is this shell still doing something" signal.
  lastOutputAt: number;
  hasForeground: boolean;
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
  // Last effective size broadcast to clients (the min cols/rows across
  // attached clients), or null before the first compute. Tracked so the
  // manager only broadcasts pty-size on an actual change instead of every
  // resize tick. See recomputeResize for the broadcast gating.
  ptySizeCols: number | null;
  ptySizeRows: number | null;
  // Whether the last recompute saw more than one client — drives the 2→1
  // clear: when a peer detaches and drops the session to a lone viewer, one
  // final pty-size (now the lone viewer's own, unconstrained size) is sent so
  // the remaining viewer erases any mask the leaving peer imposed. Stays false
  // for a lone viewer across its own resizes, so those stay quiet on the wire.
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
  private readonly coordinatorsByCwd = new Map<string, GitMetadataCoordinator>();
  private readonly hooks: SessionManagerHooks;
  private readonly sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void;
  private readonly getGraceMs: () => number | null;
  private readonly pendingPromoteTimeoutMs: number;
  private readonly shimsDir?: string;

  constructor(options: SessionManagerOptions) {
    this.hooks = options.hooks;
    this.sendControl = options.sendControl;
    this.getGraceMs = options.getGraceMs ?? (() => SESSION_GRACE_MS);
    this.pendingPromoteTimeoutMs =
      options.pendingPromoteTimeoutMs ?? SESSION_PENDING_PROMOTE_TIMEOUT_MS;
    this.shimsDir = options.shimsDir;
  }

  size(): number {
    return this.sessions.size;
  }

  atCapacity(): boolean {
    if (this.sessions.size < MAX_CONCURRENT_SESSIONS) return false;
    for (const managed of this.sessions.values()) {
      // A dormant, non-pinned session can be evicted to make room. Pinned
      // sessions hold their slots (never silently reaped), so a full cap of
      // pinned sessions surfaces a real capacity error instead of a steal.
      if (managed.clients.size === 0 && !managed.pinned) return false;
    }
    return true;
  }

  // Shell pids of every live session. The keep-awake manager scopes its `ps`
  // tree walk to these so automatic mode only reacts to programs running inside
  // localterm, not anything else on the machine.
  pids(): number[] {
    return [...this.sessions.values()].map((managed) => managed.session.pid);
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
      clientProfiles: this.clientProfilesFor(managed),
      state: this.computeState(managed),
      pinned: managed.pinned,
    }));
  }

  // The attached clients grouped by their per-browser-profile handle, for the
  // session picker's per-profile peer display. Each entry counts how many of
  // that profile's windows are viewing this PTY; sorted by count desc then id
  // for a stable order (the picker re-ranks its own profile to the front).
  private clientProfilesFor(managed: ManagedSession): SessionClientProfile[] {
    const counts = new Map<string, number>();
    for (const client of managed.clients) {
      counts.set(client.windowId, (counts.get(client.windowId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([windowId, count]) => ({ windowId, count }))
      .sort((a, b) => b.count - a.count || a.windowId.localeCompare(b.windowId));
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

  // Test-only: force output idleness (pause + backdate lastOutputAt) WITHOUT
  // clearing hasForeground, so the grace reap's foreground gate is exercised
  // against the real pty.process reading instead of being masked (markIdleForTest
  // clears both, which hides the alias-mismatch regression). Pair with a wait
  // long enough for the ForegroundWatcher to have ticked at least once.
  // Production code never needs this.
  markOutputIdleForTest(id: string): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    managed.session.pause();
    managed.lastOutputAt = 0;
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
    if (this.sessions.size >= MAX_CONCURRENT_SESSIONS) this.evictOldestDormant();
    if (this.sessions.size >= MAX_CONCURRENT_SESSIONS) return null;
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
      drainPollTimer: null,
      gitWatcher: new GitDiffWatcher(),
      lastOutputAt: Date.now(),
      hasForeground: false,
      graceTimer: null,
      parkedAt: null,
      pinned: false,
      captureRenderer: undefined,
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

  // Attach `ws` to a live PTY by id. Returns the session to reattach to, or
  // null when the id is unknown / already exited — the caller spawns fresh.
  attach(
    ws: ClientSocket,
    id: string,
    owner: SessionOwner = null,
    windowId: string = "",
  ): ManagedSession | null {
    const managed = this.sessionFor(id, owner);
    if (!managed) return null;
    // Re-subscribing cancels the no-clients grace timer (if armed): the shell
    // has a viewer again, so it stays alive.
    this.cancelGrace(managed);
    // Notify existing subscribers a peer joined (a mobile ingested this
    // session's share QR) so a host can react — e.g. the desktop's QR modal
    // auto-closes. Gated on existing clients so a fresh spawn's first attach
    // stays silent, and fired before adding the joiner so it isn't told about
    // itself. See peerAttachedMessageSchema for the frame's payload rationale.
    if (managed.clients.size > 0) this.broadcast(managed, { type: "peer-attached" });
    const coordinator = this.coordinatorForCwd(managed.session.cwd);
    const client: ManagedClient = {
      ws,
      pending: true,
      pendingControl: [],
      pendingBytes: [],
      pendingTimer: null,
      cols: 0,
      rows: 0,
      windowId,
      coordinator,
      compressMode: null,
      brotliEncoder: null,
    };
    coordinator.add(ws);
    managed.clients.add(client);
    this.wsToClient.set(ws, { client, session: managed });
    this.recomputeResize(managed);
    // Seed a joiner with the current effective size when it's entering an
    // already-multi-viewer session whose min its own (possibly wider) report
    // doesn't change — recomputeResize only broadcasts on a change, so without
    // this the new viewer would never learn it's constrained and would render
    // no mask. A fresh spawn (now the lone viewer) has no stored size and is
    // skipped, and a joiner that changes the min is reached by the broadcast.
    if (managed.clients.size > 1 && managed.ptySizeCols !== null && managed.ptySizeRows !== null) {
      this.sendToClient(client, {
        type: "pty-size",
        cols: managed.ptySizeCols,
        rows: managed.ptySizeRows,
      });
    }
    // Auto-promote a client that never sends {type:"ready"} — a back-compat
    // client (an older bundled terminal, or any plain WS reader) would otherwise
    // stay pending and never receive output. The localterm client sends ready
    // within milliseconds of the session frame; the window is sized to clear a
    // mobile/tailscale RTT (often DERP-relayed) so its {ready} lands first and
    // its scrollback replay still lands before live fan-out. `promote` always
    // sends `replay-end`, so even a slow link that auto-promotes with
    // `replay: false` can't deadlock the client in its replay window.
    client.pendingTimer = setTimeout(
      () => void this.promote(ws, false),
      this.pendingPromoteTimeoutMs,
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
  //
  // `replay-end` is sent on EVERY promote (not just `replay: true`): the
  // localterm client opens its suppressed-replay window on the {session}
  // frame — before its {ready} reaches us — so a slow link whose pending
  // timeout auto-promotes with `replay: false` would otherwise never send the
  // marker the client is waiting on, deadlocking it on a blank screen with
  // every output frame buffered client-side. The auto-promote's `replay-end`
  // lets the client flush whatever it buffered (the pending bytes that raced
  // ahead of the marker) and rejoin live fan-out. A client that didn't open the
  // window (a silent reattach, or a back-compat reader) treats it as a no-op.
  async promote(ws: ClientSocket, replay: boolean, compress: CompressMode = null): Promise<void> {
    const entry = this.wsToClient.get(ws);
    if (!entry) return;
    const client = entry.client;
    if (!client.pending) return;
    if (client.pendingTimer !== null) {
      clearTimeout(client.pendingTimer);
      client.pendingTimer = null;
    }
    client.compressMode = compress;
    // Reset the persistent Brotli encoder: a new promote is a fresh attach (a
    // PTY switch or reconnect), so the prior screen's LZ77 context is stale.
    // The first frame of the new stream has no prior context (the per-frame
    // equivalent); subsequent frames compress against it.
    if (client.brotliEncoder !== null) {
      client.brotliEncoder.release();
      client.brotliEncoder = null;
    }
    if (compress === "br-ctx") client.brotliEncoder = makeBrotliEncoder(WS_OUTPUT_BROTLI_QUALITY);
    // Tell the client the chosen compress mode BEFORE the scrollback replay so
    // it knows how to parse the compressed replay frames. A back-compat server
    // that doesn't know "br-ctx" never sends this frame, so an old-server +
    // new-client pair degrades to raw (no header) instead of mis-parsing.
    this.sendControl(ws, { type: "compress", mode: compress });
    if (replay) {
      await this.sendScrollback(ws, entry.session, client);
    }
    // Tell the client the replay bytes have all landed so it can write them as
    // one suppressed block (dropping xterm's responses to the stale query
    // requests in the ring buffer). Sent on every promote — even when the
    // snapshot was empty or replay wasn't requested — so the client always
    // exits its suppressed-replay window and never deadlocks on a slow link.
    this.sendControl(ws, { type: "replay-end" });
    for (const payload of client.pendingControl) this.sendControl(ws, payload);
    for (const bytes of client.pendingBytes) await this.sendOutputFrame(ws, bytes, client);
    client.pendingControl = [];
    client.pendingBytes = [];
    client.pending = false;
    // Re-push the ambient git-diff summary to the now-live client so a summary
    // pushed while pending (and wiped by the client's cwd-driven null-reset on
    // a cwd change during the pending window) is restored. See
    // GitMetadataCoordinator.replayLastSummary.
    client.coordinator?.replayLastSummary(ws);
  }

  writeInput(ws: ClientSocket, data: string): void {
    const entry = this.wsToClient.get(ws);
    if (!entry) return;
    // A client sending input is clearly live and wants output. Promote it out
    // of the pending hold without a scrollback replay — a back-compat client
    // that never sends {type:"ready"} still unblocks on its first keystroke.
    // The localterm client sends {type:"ready"} before any input, so this is a
    // no-op for it. Promote flushes any buffered output before the input echoes.
    if (entry.client.pending) void this.promote(ws, false);
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
    if (client.brotliEncoder !== null) {
      client.brotliEncoder.release();
      client.brotliEncoder = null;
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
    this.coordinatorsByCwd.clear();
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
    if (managed.clients.size === 0 && !managed.session.isExited) this.startGrace(managed);
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
    const capped = lines && lines > 0 ? Math.min(lines, CAPTURE_PANE_MAX_LINES) : undefined;
    const renderer = await this.ensureCaptureRenderer(managed);
    return renderer.capture(capped);
  }

  // Toggle a session's pinned flag — PATCH /api/sessions/:id. Re-arms (or
  // cancels) the grace timer live for a dormant session so the change takes
  // effect immediately, not on the next detach. Returns false for an unknown id.
  setPinned(id: string, pinned: boolean, owner: SessionOwner = null): boolean {
    const managed = this.sessions.get(id);
    if (!managed || (owner !== null && managed.owner !== owner)) return false;
    managed.pinned = pinned;
    if (managed.clients.size === 0 && !managed.session.isExited) this.startGrace(managed);
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
    const session = managed.session;
    const startedAt = Date.now();
    let resolved = false;
    let lastChangeAt = Date.now();
    let timeoutHandle: NodeJS.Timeout | null = null;
    let idleTimer: NodeJS.Timeout | null = null;
    return new Promise<WaitResult>((resolve) => {
      const finalize = async (matched: boolean) => {
        if (resolved) return;
        resolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (idleTimer) clearInterval(idleTimer);
        session.off("output", onOutput);
        session.off("exit", onExit);
        const snapshot = await this.capturePane(id).catch(() => "");
        resolve({
          matched,
          elapsedMs: Date.now() - startedAt,
          snapshot: snapshot ?? "",
        });
      };
      const testPredicate = async (): Promise<boolean> => {
        const renderer = await this.ensureCaptureRenderer(managed);
        await renderer.flush();
        return predicate.test(renderer.capture());
      };
      const onOutput = (): void => {
        lastChangeAt = Date.now();
        void testPredicate().then((hit) => {
          if (hit && !resolved) finalize(true);
        });
      };
      const onExit = (): void => {
        void finalize(false);
      };
      // Idle mode: resolve once no output has arrived for `idleMs`. The interval
      // checks recency without forcing a renderer read each tick (the output
      // listener already bumps lastChangeAt).
      if (predicate.kind === "idle") {
        idleTimer = setInterval(() => {
          if (!resolved && Date.now() - lastChangeAt >= (idleMs ?? 0)) finalize(true);
        }, WAIT_IDLE_POLL_INTERVAL_MS);
        idleTimer.unref?.();
      } else {
        // Text/regex: test once up front in case the pane already matches, then
        // react to output events.
        void testPredicate().then((hit) => {
          if (hit && !resolved) finalize(true);
        });
      }
      session.on("output", onOutput);
      session.on("exit", onExit);
      timeoutHandle = setTimeout(() => finalize(false), timeoutMs);
      timeoutHandle.unref?.();
    });
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
    const renderer = await this.ensureCaptureRenderer(managed);
    await renderer.flush();
    return renderer.findTextInViewport(needle);
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

  // Lazily create (and prime) a session's capture renderer. Fed the scrollback
  // snapshot at creation so it catches up on recent history before the renderer
  // existed, then kept alive and fed live output by onSessionOutput. Awaits the
  // snapshot's async parse so the first capture-pane read lands on a populated
  // grid instead of a blank one (xterm parses `write` on a timer).
  private async ensureCaptureRenderer(managed: ManagedSession): Promise<CaptureRenderer> {
    if (managed.captureRenderer) return managed.captureRenderer;
    const renderer = new CaptureRenderer(managed.session.cols, managed.session.rows);
    const snapshot = managed.session.snapshotScrollback();
    if (snapshot) renderer.write(snapshot);
    await renderer.flush();
    managed.captureRenderer = renderer;
    return renderer;
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
    const session = managed.session;

    const timeoutMs = this.clampInt(
      options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS,
      1,
      EXEC_MAX_TIMEOUT_MS,
    );
    const outputLimit = this.clampInt(
      options.outputLimitBytes ?? EXEC_DEFAULT_OUTPUT_LIMIT_BYTES,
      1,
      EXEC_MAX_OUTPUT_LIMIT_BYTES,
    );

    const token = randomBytes(8).toString("hex");
    const startMarker = `__LT_S_${token}__`;
    const endMarkerPrefix = `__LT_E_${token}__`;
    const endPattern = new RegExp(`${endMarkerPrefix} (\\d+)`);
    const cmd = command.trim() || ":";
    const wrapped = `printf '${startMarker}\\n'; ${cmd}; printf '${endMarkerPrefix} %d\\n' "$?"`;

    const startedAt = Date.now();
    let accumulated = "";
    let capped = false;
    let exitCode: number | null = null;
    let didTimeout = false;
    let resolved = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let interruptHandle: NodeJS.Timeout | null = null;

    return new Promise<ExecResult>((resolve) => {
      const finalize = async (finalExit: number | null, finalTimedOut: boolean) => {
        if (resolved) return;
        resolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (interruptHandle) clearTimeout(interruptHandle);
        session.off("output", onOutput);
        session.off("exit", onExit);
        resolve(
          await this.buildExecResult(
            session.cols,
            session.rows,
            accumulated,
            startMarker,
            endMarkerPrefix,
            finalExit,
            finalTimedOut,
            outputLimit,
            startedAt,
          ),
        );
      };

      const onOutput = (data: string): void => {
        if (!capped) {
          if (accumulated.length + data.length <= EXEC_RAW_ACCUMULATE_CAP_BYTES) {
            accumulated += data;
          } else {
            const room = EXEC_RAW_ACCUMULATE_CAP_BYTES - accumulated.length;
            if (room > 0) accumulated += data.slice(0, room);
            capped = true;
          }
        }
        // Once the timeout has fired we've committed to a timed-out result; a
        // marker arriving during the interrupt grace (Ctrl-C kills the command,
        // the trailing `printf END $?` runs with the interrupt exit code) is
        // ignored so the call resolves as timed out, not as a normal completion.
        if (didTimeout) return;
        const match = accumulated.match(endPattern);
        if (match) {
          exitCode = Number.parseInt(match[1], 10);
          finalize(exitCode, false);
        }
      };
      const onExit = (code: number | null): void => {
        exitCode = code;
        finalize(code, false);
      };

      session.on("output", onOutput);
      session.on("exit", onExit);

      timeoutHandle = setTimeout(() => {
        // Commit to a timed-out result: the command didn't finish within
        // timeoutMs. Send Ctrl-C to interrupt it (so the session returns to a
        // prompt for a follow-up call), then resolve after a short grace so any
        // output already in flight is captured into the partial result. A marker
        // arriving during the grace is ignored (see onOutput).
        didTimeout = true;
        session.write("\x03");
        interruptHandle = setTimeout(() => finalize(null, true), EXEC_TIMEOUT_INTERRUPT_GRACE_MS);
        interruptHandle.unref?.();
      }, timeoutMs);
      timeoutHandle.unref?.();

      // A client sending input is live; for a detached session there's no
      // pending handshake, so the bytes reach the PTY directly.
      session.write(`${wrapped}\r`);
    });
  }

  private async buildExecResult(
    cols: number,
    rows: number,
    accumulated: string,
    startMarker: string,
    endMarkerPrefix: string,
    exitCode: number | null,
    timedOut: boolean,
    outputLimit: number,
    startedAt: number,
  ): Promise<ExecResult> {
    // Render the captured raw stream through a fresh headless terminal and slice
    // between the start/end marker rows for clean, ANSI-processed text. A fresh
    // (not the persistent) renderer so this exec's output is isolated and the
    // markers are always near the bottom of the buffer.
    const renderer = new CaptureRenderer(cols, rows, EXEC_EPHEMERAL_SCROLLBACK);
    let output: string;
    try {
      renderer.write(accumulated);
      await renderer.flush();
      const endRow =
        exitCode !== null && !timedOut ? renderer.findRow(`${endMarkerPrefix} ${exitCode}`) : -1;
      const startRow = renderer.findRow(startMarker);
      output = renderer.extractBetween(startRow, endRow);
    } finally {
      renderer.dispose();
    }
    const textBytes = Buffer.byteLength(output, "utf8");
    const truncated = textBytes > outputLimit;
    if (truncated) {
      output = Buffer.from(output, "utf8").subarray(0, outputLimit).toString("utf8");
    }
    return {
      exitCode,
      output,
      timedOut,
      truncated,
      durationMs: Date.now() - startedAt,
    };
  }

  private clampInt(value: number, min: number, max: number): number {
    return Math.min(Math.max(Math.trunc(value), min), max);
  }

  private async sendScrollback(
    ws: ClientSocket,
    managed: ManagedSession,
    client: ManagedClient,
  ): Promise<void> {
    const snapshot = managed.session.snapshotScrollback();
    if (!snapshot) return;
    const bytes = Buffer.from(snapshot, "utf8");
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_OUTPUT_BYTES) {
      await this.sendOutputFrame(ws, bytes.subarray(offset, offset + MAX_OUTPUT_BYTES), client);
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

  private compressPayload(
    bytes: Uint8Array<ArrayBuffer>,
    mode: "br" | "gzip",
  ): Buffer<ArrayBuffer> {
    return mode === "br"
      ? zlib.brotliCompressSync(bytes, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: WS_OUTPUT_BROTLI_QUALITY },
        })
      : zlib.gzipSync(bytes, { level: WS_OUTPUT_GZIP_LEVEL });
  }

  private frameWithHeader(header: number, payload: Uint8Array<ArrayBuffer>): Buffer<ArrayBuffer> {
    const out = Buffer.allocUnsafe(1 + payload.length);
    out[0] = header;
    out.set(payload, 1);
    return out;
  }

  // 5-byte header for the context-takeover mode: 0x03 + 4-byte LE raw size, so
  // the client can size-delimit a frame out of the persistent DecompressionStream
  // (which doesn't end per frame and emits in arbitrary 16KB chunks).
  private frameWithCtxHeader(
    compressed: Uint8Array<ArrayBuffer>,
    rawSize: number,
  ): Buffer<ArrayBuffer> {
    const out = Buffer.allocUnsafe(WS_OUTPUT_CTX_HEADER_BYTES + compressed.length);
    out[0] = WS_OUTPUT_BROTLI_CTX;
    out.writeUInt32LE(rawSize, 1);
    out.set(compressed, WS_OUTPUT_CTX_HEADER_BYTES);
    return out;
  }

  private async sendOutputFrame(
    ws: ClientSocket,
    bytes: Uint8Array<ArrayBuffer>,
    client: ManagedClient,
  ): Promise<void> {
    const mode = client.compressMode;
    if (mode === null) {
      this.sendOutputBytes(ws, bytes);
      return;
    }
    if (bytes.length < WS_OUTPUT_COMPRESS_THRESHOLD_BYTES) {
      this.sendOutputBytes(ws, this.frameWithHeader(WS_OUTPUT_RAW, bytes));
      return;
    }
    if (mode === "br-ctx") {
      const compressed = await client.brotliEncoder!.flush(bytes);
      this.sendOutputBytes(ws, this.frameWithCtxHeader(compressed, bytes.length));
      return;
    }
    const compressed = this.compressPayload(bytes, mode);
    this.sendOutputBytes(
      ws,
      this.frameWithHeader(mode === "br" ? WS_OUTPUT_BROTLI : WS_OUTPUT_GZIP, compressed),
    );
  }

  private broadcastBytes(managed: ManagedSession, bytes: Uint8Array<ArrayBuffer>): void {
    if (bytes.length === 0) return;
    const compressible = bytes.length >= WS_OUTPUT_COMPRESS_THRESHOLD_BYTES;
    let brotli: Buffer<ArrayBuffer> | null = null;
    let gzip: Buffer<ArrayBuffer> | null = null;
    for (const client of managed.clients) {
      if (client.pending) {
        client.pendingBytes.push(bytes);
        continue;
      }
      const mode = client.compressMode;
      if (mode === null) {
        this.sendOutputBytes(client.ws, bytes);
        continue;
      }
      if (!compressible) {
        this.sendOutputBytes(client.ws, this.frameWithHeader(WS_OUTPUT_RAW, bytes));
        continue;
      }
      if (mode === "br-ctx") {
        // Per-client persistent stream: the flush is async (chained per encoder
        // in PTY order), so fire-and-forget here — the chain preserves order
        // across this client's frames and sendOutputBytes checks
        // readyState/backpressure at send time.
        void client
          .brotliEncoder!.flush(bytes)
          .then((compressed) =>
            this.sendOutputBytes(client.ws, this.frameWithCtxHeader(compressed, bytes.length)),
          );
        continue;
      }
      if (mode === "br") {
        if (brotli === null) brotli = this.compressPayload(bytes, "br");
        this.sendOutputBytes(client.ws, this.frameWithHeader(WS_OUTPUT_BROTLI, brotli));
      } else {
        if (gzip === null) gzip = this.compressPayload(bytes, "gzip");
        this.sendOutputBytes(client.ws, this.frameWithHeader(WS_OUTPUT_GZIP, gzip));
      }
    }
  }

  private sendToClient(client: ManagedClient, payload: ServerToClientMessage): void {
    if (client.pending) {
      client.pendingControl.push(payload);
      return;
    }
    this.sendControl(client.ws, payload);
  }

  private broadcast(managed: ManagedSession, payload: ServerToClientMessage): void {
    for (const client of managed.clients) this.sendToClient(client, payload);
  }

  // Fan a control message out to every client currently viewing any session
  // owned by the same identity as `managed`, not just `managed`'s own viewers.
  // Used for notifications so a user who stepped away to another session still
  // gets the ping; owner-scoped so a notification never crosses an identity
  // boundary (a non-operator client can only be attached to an owner-matching
  // session, so matching session.owner === managed.owner is the partition).
  private broadcastToOwner(managed: ManagedSession, payload: ServerToClientMessage): void {
    for (const { client, session } of this.wsToClient.values()) {
      if (session.owner === managed.owner) this.sendToClient(client, payload);
    }
  }

  private onSessionOutput(managed: ManagedSession, data: string): void {
    managed.outputBatch += data;
    managed.lastOutputAt = Date.now();
    if (managed.automation) this.appendAutomationLog(managed, data);
    this.noteOutput(managed.session.pid);
    this.hooks.onOutputActivity();
    // Keep the capture renderer (if one exists) in lockstep with the PTY so a
    // later capture-pane reads current rendered text. Lazily created, so this
    // is a no-op for sessions nobody has captured (the common browser case).
    managed.captureRenderer?.write(data);
    if (managed.outputBatch.length >= OUTPUT_BATCH_FLUSH_BYTES) {
      if (managed.outputBatchTimer !== null) {
        clearTimeout(managed.outputBatchTimer);
        managed.outputBatchTimer = null;
      }
      this.flushOutput(managed);
      return;
    }
    // Reset the coalescing window on every chunk so the flush lands
    // OUTPUT_BATCH_WINDOW_MS after the LAST chunk of a burst, not a fixed
    // window after the first. A full-screen TUI redraw of a large session
    // emits across more than the window (node-pty delivers it as many
    // 1024-byte data events over successive event-loop turns); a one-shot
    // window flushed mid-redraw and split the frame across multiple WebSocket
    // messages. Over a bandwidth-limited link each split arrives as its own
    // atomic message and xterm paints it separately — the visible
    // top-to-bottom crawl. A resetting window holds the whole burst until the
    // PTY goes idle, then sends one message; the browser receives it atomically
    // and xterm renders it in a single paint regardless of link bandwidth.
    // Sustained high-throughput output never idles, so OUTPUT_BATCH_FLUSH_BYTES
    // still gates the message rate there (unchanged).
    if (managed.outputBatchTimer !== null) clearTimeout(managed.outputBatchTimer);
    managed.outputBatchTimer = setTimeout(() => {
      managed.outputBatchTimer = null;
      this.flushOutput(managed);
    }, OUTPUT_BATCH_WINDOW_MS);
    managed.outputBatchTimer.unref?.();
  }

  // Accumulate ANSI-stripped PTY output for an automation shell run, keeping
  // the tail within the log cap so a long command's final output survives.
  private appendAutomationLog(managed: ManagedSession, data: string): void {
    const stripped = stripAnsi(data);
    if (stripped.length === 0) return;
    const combined = managed.automationLog + stripped;
    if (combined.length <= MAX_AUTOMATION_LOG_LENGTH) {
      managed.automationLog = combined;
      return;
    }
    const overflow = combined.length - MAX_AUTOMATION_LOG_LENGTH;
    managed.automationLog = combined.slice(overflow);
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
    // Keep the capture renderer's grid at the PTY's effective size so a
    // capture-pane reflects the same line wrapping a viewer would see.
    managed.captureRenderer?.resize(cols, rows);
    // The PTY's effective size is the min across attached clients (tmux-style):
    // a narrower peer constrains everyone. Broadcast it on change so each
    // viewer can mask the dead area beyond its own (possibly wider) grid as
    // inactive chrome. A lone viewer is never constrained (its effective size
    // always equals its own), so it's left quiet except for one clear frame when
    // a peer detaches and drops it back to solo — that erases the mask the
    // leaving peer had imposed. A joiner entering an already-constrained
    // session without changing the min is seeded in attach.
    const sizeChanged = managed.ptySizeCols !== cols || managed.ptySizeRows !== rows;
    managed.ptySizeCols = cols;
    managed.ptySizeRows = rows;
    if (count > 1) {
      managed.ptySizeWasMultiViewer = true;
      if (sizeChanged) {
        this.broadcast(managed, { type: "pty-size", cols, rows });
      }
    } else if (managed.ptySizeWasMultiViewer) {
      managed.ptySizeWasMultiViewer = false;
      this.broadcast(managed, { type: "pty-size", cols, rows });
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
      // Fan out across the owner's tabs, not just this session's viewers: a
      // user who stepped away to another session still gets the ping. `hasViewers`
      // lets each receiving tab suppress the notification when the session is
      // already viewed in another browser profile, and tells the SW's click
      // handler whether to open a fresh tab (orphaned) or not (avoid a duplicate).
      this.broadcastToOwner(managed, {
        type: "notification",
        sessionId: managed.id,
        body,
        hasViewers: managed.clients.size > 0,
      });
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
        this.hooks.onAutomationExit(
          automation.automationId,
          automation.runId,
          exitCode,
          managed.automationLog,
        ),
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
    managed.captureRenderer?.dispose();
    managed.captureRenderer = undefined;
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
      // Pinned sessions are never silently evicted — they're explicitly held.
      if (managed.pinned) continue;
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
    // Pinned sessions park indefinitely — never reaped by the idle grace and
    // never evicted at the cap. They live until an explicit kill or shell exit.
    if (managed.pinned) return;
    const graceMs = this.getGraceMs();
    // "Never reap": park the shell with no timer. It lingers until a viewer
    // reattaches, it's killed from the switcher, the shell exits, or it's
    // evicted at MAX_CONCURRENT_SESSIONS. parkedAt stays set so eviction
    // ordering still treats it as dormant.
    if (graceMs === null) return;
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
    }, graceMs);
    managed.graceTimer.unref?.();
  }

  // Re-arm every parked session's grace timer with the current grace value.
  // Called after a `PUT /api/config` grace change so it takes effect on shells
  // that are already dormant, not only the next detach: a finite value arms (or
  // resets) their timers, and `null` cancels them so they park indefinitely.
  rearmGrace(): void {
    for (const managed of this.sessions.values()) {
      if (managed.clients.size === 0 && !managed.session.isExited) this.startGrace(managed);
    }
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

  private coordinatorForCwd(cwd: string): GitMetadataCoordinator {
    const key = path.resolve(cwd);
    let coordinator = this.coordinatorsByCwd.get(key);
    if (!coordinator) {
      coordinator = new GitMetadataCoordinator(key, this.sendControl);
      this.coordinatorsByCwd.set(key, coordinator);
    }
    return coordinator;
  }

  private releaseCoordinator(coordinator: GitMetadataCoordinator): void {
    if (coordinator.isEmpty) this.coordinatorsByCwd.delete(coordinator.cwd);
  }

  // Push a freshly-detected PR to every tab in `cwd` after the
  // /api/git/branches/pr endpoint recomputes it, so a remote state change one
  // tab observed (a merge on GitHub) reaches siblings sharing the directory.
  // Non-creating: a cwd with no subscribers has no coordinator, and allocating
  // one here would orphan it (it never enters the attach/detach release path).
  broadcastGitBranchPr(cwd: string, pr: GitBranchPr | null): void {
    this.coordinatorsByCwd.get(path.resolve(cwd))?.broadcastPr(pr);
  }

  // Whether any tab is currently subscribed to the per-cwd coordinator — i.e.
  // there is a live audience for a PR lease refresh. Used to gate the
  // gh-activity refresh so a `gh` invocation in a cwd nobody is viewing never
  // triggers a pointless GitHub API call (mirrors broadcastGitBranchPr's
  // non-creating philosophy).
  hasCoordinatorFor(cwd: string): boolean {
    return this.coordinatorsByCwd.has(path.resolve(cwd));
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
