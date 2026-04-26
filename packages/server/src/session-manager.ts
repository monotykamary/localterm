import { EventEmitter } from "node:events";
import { resolveCwdForPid } from "./cwd-resolver.js";
import { Session } from "./session.js";
import type { CreateSessionInput, SessionMetadata } from "./types.js";

interface ManagerEvents {
  created: [session: Session];
  removed: [id: string];
}

export class SessionManager extends EventEmitter<ManagerEvents> {
  private readonly sessions = new Map<string, Session>();

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
    session.dispose();
    this.emit("removed", id);
    return true;
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }

  size(): number {
    return this.sessions.size;
  }
}
