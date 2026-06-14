import type { Session } from "./session.js";

export class SessionRegistry {
  private readonly sessions = new Set<Session>();

  register(session: Session): void {
    this.sessions.add(session);
  }

  unregister(session: Session): void {
    this.sessions.delete(session);
  }

  size(): number {
    return this.sessions.size;
  }

  // Shell pids of every live session. The keep-awake manager scopes its `ps`
  // tree walk to these so automatic mode only reacts to programs running inside
  // localterm, not anything else on the machine.
  pids(): number[] {
    return [...this.sessions].map((session) => session.pid);
  }

  disposeAll(): void {
    for (const session of this.sessions) {
      session.dispose();
    }
    this.sessions.clear();
  }
}
