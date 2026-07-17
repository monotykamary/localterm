import {
  MAX_CONCURRENT_SESSIONS,
  SESSION_ACTIVITY_WINDOW_MS,
} from "./constants.js";
import type { ManagedSession, SessionActivityState } from "./session-manager.js";

export class SessionLifecyclePolicy {
  constructor(
    private readonly getGraceMs: () => number | null,
    private readonly tearDown: (managed: ManagedSession) => void,
    private readonly onSessionActivity: () => void,
  ) {}

  atCapacity(sessions: ReadonlyMap<string, ManagedSession>): boolean {
    if (sessions.size < MAX_CONCURRENT_SESSIONS) return false;
    for (const managed of sessions.values()) {
      // A dormant, non-pinned session can be evicted to make room. Pinned
      // sessions hold their slots (never silently reaped), so a full cap of
      // pinned sessions surfaces a real capacity error instead of a steal.
      if (managed.clients.size === 0 && !managed.pinned) return false;
    }
    return true;
  }

  makeRoomForSession(sessions: ReadonlyMap<string, ManagedSession>): boolean {
    if (sessions.size >= MAX_CONCURRENT_SESSIONS) this.evictOldestDormant(sessions);
    return sessions.size < MAX_CONCURRENT_SESSIONS;
  }

  startGrace(managed: ManagedSession): void {
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
      this.onSessionActivity();
    }, graceMs);
    managed.graceTimer.unref?.();
  }

  rearmGrace(sessions: ReadonlyMap<string, ManagedSession>): void {
    for (const managed of sessions.values()) {
      if (managed.clients.size === 0 && !managed.session.isExited) this.startGrace(managed);
    }
  }

  cancelGrace(managed: ManagedSession): void {
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
  computeState(managed: ManagedSession): SessionActivityState {
    if (Date.now() - managed.lastOutputAt < SESSION_ACTIVITY_WINDOW_MS) return "running";
    return managed.hasForeground ? "alive-quiet" : "ready";
  }

  private evictOldestDormant(sessions: ReadonlyMap<string, ManagedSession>): void {
    let oldest: ManagedSession | null = null;
    let oldestKey = Infinity;
    for (const managed of sessions.values()) {
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
}
