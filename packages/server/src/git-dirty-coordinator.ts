import { getGitDiffSummary, invalidateGitDiffCache } from "./git-diff.js";
import type { ServerToClientMessage } from "./types.js";
import type { ClientSocket } from "./utils/ws-socket.js";

// Git metadata is per-repo, not per-tab. Two tabs in the same cwd share one
// working tree, so a git-dirty signal from one tab — its shell's precmd OSC
// hook, or its fs watcher on .git — must refresh every tab in that cwd, not
// just the one whose shell produced the prompt. Without this, a git operation
// run inside one of two side-by-side tabs updates only that tab; the sibling
// stays stale until its own shell next renders a prompt (its precmd hook) or
// its fs watcher happens to surface the change. The summary is pathscoped to
// the cwd (`git diff` from a subdirectory lists only files under it), so the
// coordinator is keyed by cwd, not by repo — tabs in different subdirectories
// of the same repo get distinct summaries and never share.
//
// One coordinator per cwd also dedups the summary computation across concurrent
// signals from sibling tabs: their independent fs watchers and prompt hooks all
// funnel into a single in-flight pass (with one trailing pass after the burst
// settles), and the result is broadcast to every subscribed socket.
export class GitDirtyCoordinator {
  private inFlight = false;
  private pending = false;
  private readonly subscribers = new Set<ClientSocket>();

  constructor(
    readonly cwd: string,
    private readonly send: (ws: ClientSocket, payload: ServerToClientMessage) => void,
  ) {}

  add(ws: ClientSocket): void {
    this.subscribers.add(ws);
  }

  remove(ws: ClientSocket): void {
    this.subscribers.delete(ws);
  }

  get isEmpty(): boolean {
    return this.subscribers.size === 0;
  }

  signal(): void {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    this.inFlight = true;
    void this.run();
  }

  private readonly run = async (): Promise<void> => {
    try {
      // The working tree changed, so any cached full-diff pass for this cwd is
      // stale — drop it before re-reading the summary so the viewer's next
      // per-file fetch rebuilds against the new tree.
      invalidateGitDiffCache(this.cwd);
      const summary = await getGitDiffSummary(this.cwd);
      const payload: ServerToClientMessage = { type: "git-diff-summary", summary };
      for (const ws of this.subscribers) {
        this.send(ws, payload);
      }
    } catch {
      /* transient git failure; the next signal retries */
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        this.signal();
      }
    }
  };
}
