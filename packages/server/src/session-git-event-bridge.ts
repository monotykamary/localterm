import { GIT_DIFF_WATCHER_EVENT_NAMES, type GitRefEventName } from "./git-diff-watcher.js";
import { SessionClientHub } from "./session-client-hub.js";
import type { SessionEventName } from "./session-event-manager.js";
import type { ManagedSession } from "./session-manager.js";
import type { GitBranchPr } from "./types.js";

export class SessionGitEventBridge {
  constructor(
    private readonly clientHub: SessionClientHub,
    private readonly onSessionEvent: (event: SessionEventName, cwd: string) => void,
  ) {}

  installSessionListener(managed: ManagedSession): void {
    const session = managed.session;
    session.on("git-dirty", () => {
      const cwd = session.lastEmittedCwd;
      if (cwd) this.clientHub.coordinatorForCwd(cwd).signal();
      if (!managed.automation && cwd) this.onSessionEvent("git-dirty", cwd);
    });
  }

  installWatcherListeners(managed: ManagedSession): void {
    const session = managed.session;
    managed.gitWatcher.on("git-dirty", () => {
      const cwd = session.lastEmittedCwd;
      if (cwd) this.clientHub.coordinatorForCwd(cwd).signal();
    });
    for (const refEvent of GIT_DIFF_WATCHER_EVENT_NAMES) {
      if (refEvent === "git-dirty") continue;
      const eventName: GitRefEventName = refEvent;
      managed.gitWatcher.on(eventName, () => {
        if (!managed.automation && session.lastEmittedCwd) {
          this.onSessionEvent(eventName, session.lastEmittedCwd);
        }
      });
    }
  }

  startWatcher(managed: ManagedSession): void {
    managed.gitWatcher.start(managed.session.lastEmittedCwd || managed.session.cwd);
  }

  stopWatcher(managed: ManagedSession): void {
    managed.gitWatcher.stop();
  }

  handleCwdChange(managed: ManagedSession, cwd: string): void {
    managed.gitWatcher.stop();
    if (managed.clients.size > 0) managed.gitWatcher.start(cwd);
    this.clientHub.moveClientCoordinators(managed, cwd);
    if (!managed.automation) this.onSessionEvent("cwd", cwd);
  }

  dispose(managed: ManagedSession): void {
    managed.gitWatcher.dispose();
  }

  broadcastGitBranchPr(cwd: string, pr: GitBranchPr | null): void {
    this.clientHub.broadcastGitBranchPr(cwd, pr);
  }

  hasCoordinatorFor(cwd: string): boolean {
    return this.clientHub.hasCoordinatorFor(cwd);
  }
}
