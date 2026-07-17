import path from "node:path";
import {
  CLIENT_ACTIVITY_SEQUENCE_INCREMENT,
  INITIAL_CLIENT_ACTIVITY_SEQUENCE,
  WS_OUTPUT_BROTLI_QUALITY,
} from "./constants.js";
import { GitMetadataCoordinator } from "./git-metadata-coordinator.js";
import type { ManagedClient, ManagedSession } from "./session-manager.js";
import { makeBrotliEncoder, SessionOutputTransport } from "./session-output-transport.js";
import type { CompressMode } from "./schemas.js";
import type { GitBranchPr, ServerToClientMessage, SessionClientProfile } from "./types.js";
import type { SessionOwner } from "./identity/types.js";
import type { ClientSocket } from "./utils/ws-socket.js";
import type { WorkspaceEntry, WorkspaceTab } from "./workspace-store.js";

interface SessionClientEntry {
  client: ManagedClient;
  session: ManagedSession;
}

interface SessionClientHubOptions {
  outputTransport: SessionOutputTransport;
  sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void;
  pendingPromoteTimeoutMs: number;
  sessionFor: (id: string, owner: SessionOwner) => ManagedSession | null;
  cancelGrace: (managed: ManagedSession) => void;
  startGrace: (managed: ManagedSession) => void;
  onSessionActivity: () => void;
}

export class SessionClientHub {
  private readonly wsToClient = new Map<ClientSocket, SessionClientEntry>();
  private readonly coordinatorsByCwd = new Map<string, GitMetadataCoordinator>();
  private readonly outputTransport: SessionOutputTransport;
  private readonly sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void;
  private readonly pendingPromoteTimeoutMs: number;
  private readonly sessionFor: (id: string, owner: SessionOwner) => ManagedSession | null;
  private readonly cancelGrace: (managed: ManagedSession) => void;
  private readonly startGrace: (managed: ManagedSession) => void;
  private readonly onSessionActivity: () => void;
  private nextActivitySequence = INITIAL_CLIENT_ACTIVITY_SEQUENCE;

  constructor(options: SessionClientHubOptions) {
    this.outputTransport = options.outputTransport;
    this.sendControl = options.sendControl;
    this.pendingPromoteTimeoutMs = options.pendingPromoteTimeoutMs;
    this.sessionFor = options.sessionFor;
    this.cancelGrace = options.cancelGrace;
    this.startGrace = options.startGrace;
    this.onSessionActivity = options.onSessionActivity;
  }

  // The attached clients grouped by their per-browser-profile handle, for the
  // session picker's per-profile peer display. Each entry counts how many of
  // that profile's windows are viewing this PTY; sorted by count desc then id
  // for a stable order (the picker re-ranks its own profile to the front).
  clientProfilesFor(managed: ManagedSession): SessionClientProfile[] {
    const counts = new Map<string, number>();
    for (const client of managed.clients) {
      counts.set(client.windowId, (counts.get(client.windowId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([windowId, count]) => ({ windowId, count }))
      .sort(
        (firstProfile, secondProfile) =>
          secondProfile.count - firstProfile.count ||
          firstProfile.windowId.localeCompare(secondProfile.windowId),
      );
  }

  // The persisted workspace manifest: every currently-open tab, grouped by
  // (owner, windowId), recording the live cwd + shell to respawn it in. A
  // session with N attached clients of one windowId contributes N tabs (each
  // viewer is a tab). Automation-run sessions are skipped (their tabs are
  // one-shot), and sessions with no clients (dormant/orphaned) contribute
  // nothing — only tabs that are actively open are restored. Computed from
  // in-memory state, so the daemon snapshots it to disk before a graceful
  // stop (and debounced during life for crash recovery).
  workspaceEntries(sessions: Iterable<ManagedSession>): WorkspaceEntry[] {
    const byKey = new Map<string, WorkspaceEntry>();
    const now = Date.now();
    for (const managed of sessions) {
      if (managed.automation) continue;
      if (managed.clients.size === 0) continue;
      const cwd = managed.session.lastEmittedCwd || managed.session.cwd;
      const shell = managed.session.shell;
      const tab: WorkspaceTab = { cwd, shell };
      for (const client of managed.clients) {
        if (!client.windowId) continue;
        const key = `${managed.owner ?? ""}\u0000${client.windowId}`;
        let entry = byKey.get(key);
        if (!entry) {
          entry = { owner: managed.owner, windowId: client.windowId, tabs: [], savedAt: now };
          byKey.set(key, entry);
        }
        entry.tabs.push(tab);
      }
    }
    return [...byKey.values()];
  }

  // The (owner, windowId) a socket's tab is viewing, for scoping a CDP
  // workspace restore to the browser profile that just reconnected. Returns
  // null when the socket isn't attached to a session (e.g. a transient
  // mid-detach state).
  clientProfile(ws: ClientSocket): { owner: SessionOwner; windowId: string } | null {
    const entry = this.wsToClient.get(ws);
    if (!entry) return null;
    return { owner: entry.session.owner, windowId: entry.client.windowId };
  }

  // How many of a browser profile's tabs are currently attached to a (non-
  // automation) session — the "already open" count the restore reconciles
  // the persisted manifest against. Surviving tabs that reattach after a
  // daemon restart are counted here so the daemon only opens the deficit.
  attachedClientCount(
    sessions: Iterable<ManagedSession>,
    owner: SessionOwner,
    windowId: string,
  ): number {
    let count = 0;
    for (const managed of sessions) {
      if (owner !== null && managed.owner !== owner) continue;
      if (managed.automation) continue;
      for (const client of managed.clients) if (client.windowId === windowId) count++;
    }
    return count;
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
    if (managed.clients.size > 0)
      this.outputTransport.broadcast(managed, { type: "peer-attached" });
    const coordinator = this.coordinatorForCwd(managed.session.cwd);
    const client: ManagedClient = {
      ws,
      pending: true,
      pendingControl: [],
      pendingBytes: [],
      pendingTimer: null,
      cols: 0,
      rows: 0,
      focused: false,
      lastActivitySequence: INITIAL_CLIENT_ACTIVITY_SEQUENCE,
      windowId,
      coordinator,
      compressMode: null,
      brotliEncoder: null,
      terminalResponder: false,
    };
    coordinator.add(ws);
    managed.clients.add(client);
    this.wsToClient.set(ws, { client, session: managed });
    if (managed.resizeOwner === null) {
      this.promoteResizeOwner(managed, client);
    } else {
      this.recomputeResize(managed);
    }
    // Seed a joiner with the active viewer's current effective size when it
    // enters a multi-viewer session without changing the PTY size.
    // recomputeResize only broadcasts on a change, so without
    // this the new viewer would not learn the live width or render a mask. A
    // fresh spawn has no stored size and is skipped.
    if (managed.clients.size > 1 && managed.ptySizeCols !== null && managed.ptySizeRows !== null) {
      this.outputTransport.sendToClient(client, {
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
    this.onSessionActivity();
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
    this.ensureTerminalResponder(entry.session, client);
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
      await this.outputTransport.sendScrollback(ws, entry.session, client);
    }
    // Tell the client the replay bytes have all landed so it can write them as
    // one suppressed block (dropping xterm's responses to the stale query
    // requests in the ring buffer). Sent on every promote — even when the
    // snapshot was empty or replay wasn't requested — so the client always
    // exits its suppressed-replay window and never deadlocks on a slow link.
    this.sendControl(ws, { type: "replay-end" });
    for (const payload of client.pendingControl) this.sendControl(ws, payload);
    for (const bytes of client.pendingBytes) {
      await this.outputTransport.sendOutputFrame(ws, bytes, client);
    }
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
    entry.client.focused = true;
    this.promoteResizeOwner(entry.session, entry.client);
    // Query replies follow the viewer that most recently drove the PTY.
    this.assignTerminalResponder(entry.session, entry.client);
    entry.session.session.write(data);
  }

  writeTerminalResponse(ws: ClientSocket, data: string): void {
    const entry = this.wsToClient.get(ws);
    if (!entry?.client.terminalResponder) return;
    entry.session.session.write(data);
  }

  setClientFocus(ws: ClientSocket, focused: boolean): void {
    const entry = this.wsToClient.get(ws);
    if (!entry) return;
    entry.client.focused = focused;
    if (focused) {
      this.promoteResizeOwner(entry.session, entry.client);
      return;
    }
    if (entry.session.resizeOwner !== entry.client) return;
    const focusedClient = this.latestClientByActivity(entry.session, true);
    if (focusedClient) this.promoteResizeOwner(entry.session, focusedClient);
  }

  private ensureTerminalResponder(managed: ManagedSession, preferredClient?: ManagedClient): void {
    for (const client of managed.clients) {
      if (client.terminalResponder) return;
    }
    const nextClient =
      preferredClient ??
      Array.from(managed.clients).find((client) => !client.pending) ??
      managed.clients.values().next().value;
    if (nextClient) this.assignTerminalResponder(managed, nextClient);
  }

  private assignTerminalResponder(managed: ManagedSession, responder: ManagedClient): void {
    for (const client of managed.clients) client.terminalResponder = client === responder;
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
    if (entry.session.resizeOwner === entry.client) this.recomputeResize(entry.session);
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
    this.releaseClient(client);
    managed.clients.delete(client);
    if (managed.resizeOwner === client) {
      managed.resizeOwner =
        this.latestClientByActivity(managed, true) ?? this.latestClientByActivity(managed, false);
    }
    if (client.terminalResponder) this.ensureTerminalResponder(managed);
    this.recomputeResize(managed);
    if (managed.clients.size === 0 && !managed.session.isExited) this.startGrace(managed);
    this.onSessionActivity();
  }

  // Fan a control message out to every client currently viewing any session
  // owned by the same identity as `managed`, not just `managed`'s own viewers.
  // Used for notifications so a user who stepped away to another session still
  // gets the ping; owner-scoped so a notification never crosses an identity
  // boundary (a non-operator client can only be attached to an owner-matching
  // session, so matching session.owner === managed.owner is the partition).
  broadcastToOwner(managed: ManagedSession, payload: ServerToClientMessage): void {
    for (const { client, session } of this.wsToClient.values()) {
      if (session.owner === managed.owner) this.outputTransport.sendToClient(client, payload);
    }
  }

  private promoteResizeOwner(managed: ManagedSession, client: ManagedClient): void {
    this.nextActivitySequence += CLIENT_ACTIVITY_SEQUENCE_INCREMENT;
    client.lastActivitySequence = this.nextActivitySequence;
    if (managed.resizeOwner === client) return;
    managed.resizeOwner = client;
    this.recomputeResize(managed);
  }

  private latestClientByActivity(
    managed: ManagedSession,
    focusedOnly: boolean,
  ): ManagedClient | null {
    let latestClient: ManagedClient | null = null;
    for (const client of managed.clients) {
      if (focusedOnly && !client.focused) continue;
      if (
        latestClient === null ||
        client.lastActivitySequence > latestClient.lastActivitySequence
      ) {
        latestClient = client;
      }
    }
    return latestClient;
  }

  private recomputeResize(managed: ManagedSession): void {
    const session = managed.session;
    const resizeOwner = managed.resizeOwner;
    if (session.isExited || resizeOwner === null) return;
    const { cols, rows } = resizeOwner;
    if (cols <= 0 || rows <= 0) return;
    const count = managed.clients.size;
    if (
      count === 1 &&
      resizeOwner.pixelWidth !== undefined &&
      resizeOwner.pixelHeight !== undefined
    ) {
      session.resize(cols, rows, resizeOwner.pixelWidth, resizeOwner.pixelHeight);
    } else {
      session.resize(cols, rows);
    }
    // Keep the capture renderer's grid at the PTY's effective size so a
    // capture-pane reflects the same line wrapping a viewer would see.
    managed.captureRenderer?.resize(cols, rows);
    // One PTY can only have one size. Following the most recently focused or
    // interactive viewer makes a mobile-to-desktop handoff resize immediately
    // instead of leaving every viewer constrained by the phone. Passive wider
    // clients still receive pty-size so they can mask their dead columns.
    const sizeChanged = managed.ptySizeCols !== cols || managed.ptySizeRows !== rows;
    managed.ptySizeCols = cols;
    managed.ptySizeRows = rows;
    if (count > 1) {
      managed.ptySizeWasMultiViewer = true;
      if (sizeChanged) {
        this.outputTransport.broadcast(managed, { type: "pty-size", cols, rows });
      }
    } else if (managed.ptySizeWasMultiViewer) {
      managed.ptySizeWasMultiViewer = false;
      this.outputTransport.broadcast(managed, { type: "pty-size", cols, rows });
    }
  }

  moveClientCoordinators(managed: ManagedSession, cwd: string): void {
    for (const client of managed.clients) this.moveClientCoordinator(client, cwd);
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

  tearDown(managed: ManagedSession): void {
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
    managed.resizeOwner = null;
  }

  private releaseClient(client: ManagedClient): void {
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
      client.coordinator.remove(client.ws);
      this.releaseCoordinator(client.coordinator);
    }
  }

  dispose(): void {
    this.coordinatorsByCwd.clear();
  }

  coordinatorForCwd(cwd: string): GitMetadataCoordinator {
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
