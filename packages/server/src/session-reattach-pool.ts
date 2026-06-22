import { randomUUID } from "node:crypto";
import { SESSION_GRACE_MS } from "./constants.js";
import type { Session } from "./session.js";

export interface ParkedSession {
  session: Session;
  sid: string;
  claimedRunId: string | null;
  claimedTargetId: string | null;
  automationId: string | null;
  expiresAt: number;
  exitHandler: (code: number | null) => void;
  graceTimer: NodeJS.Timeout;
}

export interface ParkOptions {
  sid: string;
  claimedRunId: string | null;
  claimedTargetId: string | null;
  automationId: string | null;
}

export interface SessionReattachPoolHooks {
  onReattach?: (parked: ParkedSession) => void;
  onExpire?: (parked: ParkedSession) => void;
  onExitWhileParked?: (parked: ParkedSession, code: number | null) => void;
}

export const generateSessionId = (): string => randomUUID();

export class SessionReattachPool {
  private readonly parked = new Map<string, ParkedSession>();
  private readonly graceMs: number;
  private readonly hooks: SessionReattachPoolHooks;

  constructor(options: { graceMs?: number; hooks?: SessionReattachPoolHooks } = {}) {
    this.graceMs = options.graceMs ?? SESSION_GRACE_MS;
    this.hooks = options.hooks ?? {};
  }

  size(): number {
    return this.parked.size;
  }

  has(sid: string): boolean {
    return this.parked.has(sid);
  }

  /**
   * Park a live Session behind `sid` so the next WS open carrying that sid
   * can reattach. Strips the Session's emitter listeners (the prior WS's
   * per-connection closures reference the dead ws) and installs a single exit
   * watcher so a shell that exits while parked tears the parked entry down
   * promptly instead of waiting out the grace timer.
   *
   * Throws if `sid` already maps to a parked session — sid collisions on a
   * fresh UUID are astronomically unlikely but should never silently clobber
   * an in-flight entry.
   */
  park(session: Session, options: ParkOptions): ParkedSession {
    const sid = options.sid;
    if (this.parked.has(sid)) {
      throw new Error(`SessionReattachPool: sid ${sid} already parked`);
    }
    session.removeAllListeners();
    const exitHandler = (code: number | null) => {
      this.parked.delete(sid);
      clearTimeout(parked.graceTimer);
      // PTY already exited — dispose is idempotent (kill() no-ops, listeners
      // already stripped); call it for foreground-watcher/hook-file cleanup.
      try {
        session.dispose();
      } catch {
        /* already torn down */
      }
      this.hooks.onExitWhileParked?.(parked, code);
    };
    const parked: ParkedSession = {
      session,
      sid,
      claimedRunId: options.claimedRunId,
      claimedTargetId: options.claimedTargetId,
      automationId: options.automationId,
      expiresAt: Date.now() + this.graceMs,
      exitHandler,
      graceTimer: undefined as unknown as NodeJS.Timeout,
    };
    parked.graceTimer = setTimeout(() => {
      this.parked.delete(sid);
      try {
        session.dispose();
      } catch {
        /* already gone */
      }
      this.hooks.onExpire?.(parked);
    }, this.graceMs);
    parked.graceTimer.unref?.();
    session.on("exit", exitHandler);
    this.parked.set(sid, parked);
    return parked;
  }

  claim(sid: string): ParkedSession | null {
    const parked = this.parked.get(sid);
    if (!parked) return null;
    this.parked.delete(sid);
    clearTimeout(parked.graceTimer);
    try {
      parked.session.off("exit", parked.exitHandler);
    } catch {
      /* already off */
    }
    this.hooks.onReattach?.(parked);
    return parked;
  }

  disposeAll(): void {
    for (const parked of this.parked.values()) {
      clearTimeout(parked.graceTimer);
      try {
        parked.session.removeAllListeners();
        parked.session.dispose();
      } catch {
        /* already torn down */
      }
    }
    this.parked.clear();
  }
}
