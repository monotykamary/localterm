import {
  GIT_DIFF_WATCHER_EVENT_NAMES,
  GitDiffWatcher,
  resolveGitDir,
  type GitRefEventName,
} from "./git-diff-watcher.js";
import { SessionClientHub } from "./session-client-hub.js";
import type { SessionEventName } from "./session-event-manager.js";
import type { ManagedSession } from "./session-manager.js";
import type { GitBranchPr } from "./types.js";

interface SharedGitWatcherEntry {
  watcher: GitDiffWatcher;
  cwdBySession: Map<ManagedSession, string>;
}

export class SessionGitEventBridge {
  private readonly watcherByGitDir = new Map<string, SharedGitWatcherEntry>();
  private readonly gitDirBySession = new Map<ManagedSession, string>();

  constructor(
    private readonly clientHub: SessionClientHub,
    private readonly onSessionEvent: (event: SessionEventName, cwd: string) => void,
  ) {}

  installSessionListener(managed: ManagedSession): void {
    const session = managed.session;
    session.on("git-dirty", () => {
      const cwd = session.lastEmittedCwd;
      if (cwd) this.clientHub.signalCoordinatorForCwd(cwd);
      if (!managed.automation && cwd) this.onSessionEvent("git-dirty", cwd);
    });
  }

  startWatcher(managed: ManagedSession, requestedCwd?: string): void {
    const cwd = requestedCwd || managed.session.lastEmittedCwd || managed.session.cwd;
    const resolved = resolveGitDir(cwd);
    if (!resolved) {
      this.stopWatcher(managed);
      return;
    }

    const gitDir = resolved.gitDir;
    const currentGitDir = this.gitDirBySession.get(managed);
    if (currentGitDir === gitDir) {
      this.watcherByGitDir.get(gitDir)?.cwdBySession.set(managed, cwd);
      return;
    }
    this.stopWatcher(managed);

    let entry = this.watcherByGitDir.get(gitDir);
    const shouldStartWatcher = entry === undefined;
    if (!entry) {
      entry = {
        watcher: new GitDiffWatcher(),
        cwdBySession: new Map(),
      };
      this.installSharedWatcherListeners(entry);
      this.watcherByGitDir.set(gitDir, entry);
    }
    entry.cwdBySession.set(managed, cwd);
    this.gitDirBySession.set(managed, gitDir);
    if (shouldStartWatcher) entry.watcher.start(cwd);
  }

  stopWatcher(managed: ManagedSession): void {
    const gitDir = this.gitDirBySession.get(managed);
    if (!gitDir) return;
    this.gitDirBySession.delete(managed);
    const entry = this.watcherByGitDir.get(gitDir);
    if (!entry) return;
    entry.cwdBySession.delete(managed);
    if (entry.cwdBySession.size > 0) return;
    entry.watcher.dispose();
    this.watcherByGitDir.delete(gitDir);
  }

  handleCwdChange(managed: ManagedSession, cwd: string): void {
    if (managed.clients.size > 0) this.startWatcher(managed, cwd);
    else this.stopWatcher(managed);
    this.clientHub.moveClientCoordinators(managed, cwd);
    if (!managed.automation) this.onSessionEvent("cwd", cwd);
  }

  dispose(managed: ManagedSession): void {
    this.stopWatcher(managed);
  }

  broadcastGitBranchPr(cwd: string, pr: GitBranchPr | null): void {
    this.clientHub.broadcastGitBranchPr(cwd, pr);
  }

  hasCoordinatorFor(cwd: string): boolean {
    return this.clientHub.hasCoordinatorFor(cwd);
  }

  private installSharedWatcherListeners(entry: SharedGitWatcherEntry): void {
    entry.watcher.on("git-dirty", () => {
      for (const cwd of new Set(entry.cwdBySession.values())) {
        this.clientHub.signalCoordinatorForCwd(cwd);
      }
    });
    for (const refEvent of GIT_DIFF_WATCHER_EVENT_NAMES) {
      if (refEvent === "git-dirty") continue;
      const eventName: GitRefEventName = refEvent;
      entry.watcher.on(eventName, () => {
        const cwdValues = new Set<string>();
        for (const [managed, cwd] of entry.cwdBySession) {
          if (!managed.automation) cwdValues.add(cwd);
        }
        for (const cwd of cwdValues) this.onSessionEvent(eventName, cwd);
      });
    }
  }
}
