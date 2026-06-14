import type { Session } from "./session.js";

export class SessionRegistry {
  private readonly sessions = new Set<Session>();
  private readonly lastOutputAtByPid = new Map<number, number>();

  register(session: Session): void {
    this.sessions.add(session);
  }

  unregister(session: Session): void {
    this.sessions.delete(session);
    this.lastOutputAtByPid.delete(session.pid);
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

  // Record that a session just produced output. Called by index.ts on every
  // `session.on("output")` so the activity gate can check recent output.
  noteOutput(pid: number): void {
    this.lastOutputAtByPid.set(pid, Date.now());
  }

  // Whether any session with the given pids produced output within the given
  // debounce window. Returns true when the activity gate is satisfied.
  hasRecentOutput(pids: readonly number[], withinMs: number): boolean {
    const cutoff = Date.now() - withinMs;
    for (const pid of pids) {
      const at = this.lastOutputAtByPid.get(pid);
      if (at !== undefined && at >= cutoff) return true;
    }
    return false;
  }

  disposeAll(): void {
    for (const session of this.sessions) {
      session.dispose();
    }
    this.sessions.clear();
    this.lastOutputAtByPid.clear();
  }
}
