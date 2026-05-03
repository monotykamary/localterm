import { EventEmitter } from "node:events";
import { SESSION_IDLE_REAP_MS } from "./constants.js";
import { resolveCwdForPid } from "./cwd-resolver.js";
import { Session } from "./session.js";
import type { CreateSessionInput, SessionMetadata } from "./types.js";

interface ManagerEvents {
  created: [session: Session];
  removed: [id: string];
  reaped: [id: string];
}

export type SetReapTimer = (handler: () => void, delayMs: number) => unknown;
export type ClearReapTimer = (handle: unknown) => void;

export interface SessionManagerOptions {
  idleReapMs?: number;
  setTimer?: SetReapTimer;
  clearTimer?: ClearReapTimer;
}

const defaultSetTimer: SetReapTimer = (handler, delayMs) => {
  const handle = setTimeout(handler, delayMs);
  if (typeof handle === "object" && handle && typeof handle.unref === "function") {
    handle.unref();
  }
  return handle;
};

const defaultClearTimer: ClearReapTimer = (handle) => {
  if (handle === undefined || handle === null) return;
  clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
};

export class SessionManager extends EventEmitter<ManagerEvents> {
  private readonly sessions = new Map<string, Session>();
  private readonly reapTimers = new Map<string, unknown>();
  private readonly idleReapMs: number;
  private readonly setTimer: SetReapTimer;
  private readonly clearTimer: ClearReapTimer;

  constructor(options: SessionManagerOptions = {}) {
    super();
    this.idleReapMs = options.idleReapMs ?? SESSION_IDLE_REAP_MS;
    this.setTimer = options.setTimer ?? defaultSetTimer;
    this.clearTimer = options.clearTimer ?? defaultClearTimer;
  }

  async create(input: CreateSessionInput = {}): Promise<Session> {
    const resolvedCwd = await this.resolveSpawnCwd(input);
    const session = new Session({ ...input, cwd: resolvedCwd });
    this.sessions.set(session.id, session);
    session.once("exit", () => {
      setTimeout(() => this.remove(session.id), 0);
    });
    this.emit("created", session);
    return session;
  }

  private async resolveSpawnCwd(input: CreateSessionInput): Promise<string | undefined> {
    if (input.cwd) return input.cwd;
    if (!input.inheritCwdFromSessionId) return undefined;
    const source = this.sessions.get(input.inheritCwdFromSessionId);
    if (!source || source.isExited) return undefined;
    const inherited = await resolveCwdForPid(source.pid);
    return inherited ?? undefined;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionMetadata[] {
    return Array.from(this.sessions.values()).map((session) => session.metadata());
  }

  remove(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    this.cancelReap(id);
    session.dispose();
    this.emit("removed", id);
    return true;
  }

  attach(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.attach();
    this.cancelReap(id);
  }

  detach(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.detach();
    if (session.hasAttachments) return;
    if (session.isExited) return;
    this.scheduleReap(id);
  }

  private scheduleReap(id: string): void {
    this.cancelReap(id);
    const handle = this.setTimer(() => {
      this.reapTimers.delete(id);
      const target = this.sessions.get(id);
      if (!target || target.hasAttachments) return;
      this.sessions.delete(id);
      target.dispose();
      this.emit("reaped", id);
      this.emit("removed", id);
    }, this.idleReapMs);
    this.reapTimers.set(id, handle);
  }

  private cancelReap(id: string): void {
    const handle = this.reapTimers.get(id);
    if (handle === undefined) return;
    this.clearTimer(handle);
    this.reapTimers.delete(id);
  }

  disposeAll(): void {
    for (const handle of this.reapTimers.values()) {
      this.clearTimer(handle);
    }
    this.reapTimers.clear();
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }

  size(): number {
    return this.sessions.size;
  }
}
