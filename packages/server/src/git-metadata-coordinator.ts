import { getGitDiffSummary, invalidateGitDiffCache } from "./git-diff.js";
import type { GitBranchPr, GitDiffSummary, ServerToClientMessage } from "./types.js";
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
//
// The PR lease rides the same subscriber set but is driven differently: it
// reflects remote GitHub state (open/merged/closed), which a working-tree edit
// never changes, so a git-dirty signal must NOT refetch it. Instead the
// /api/git/branches/pr endpoint recomputes the PR and calls broadcastPr to push
// the fresh value to every tab in the cwd — so a manual refresh on one tab
// propagates a "merged" transition a sibling tab's shell never observed. The
// PR is NOT replayed on subscribe: with no local signal refreshing it, a cached
// value can be arbitrarily stale, and replaying it would race a tab's own
// freshly-fetched lease. Each tab populates its initial PR from its own HTTP
// fetch and converges with siblings through these pushes.
export class GitMetadataCoordinator {
  private inFlight = false;
  private pending = false;
  private lastSummary: GitDiffSummary | null = null;
  private readonly subscribers = new Set<ClientSocket>();

  constructor(
    readonly cwd: string,
    private readonly send: (ws: ClientSocket, payload: ServerToClientMessage) => void,
  ) {}

  add(ws: ClientSocket): void {
    this.subscribers.add(ws);
    // Replay the last computed summary so a newly-subscribed tab shows the
    // ambient overlay immediately on connect/session switch instead of
    // staying blank until the next git-dirty signal. The tree didn't change
    // (the client just joined), so reuse the cache rather than invalidating
    // — invalidating on every reattach would thrash the diff viewer's cache.
    // The first subscriber (no cached summary yet) kicks off a fresh compute;
    // later subscribers piggyback on that in-flight run (they're in the
    // subscriber set, so its broadcast reaches them) instead of arming a
    // redundant trailing recompute. The PR is intentionally not replayed here
    // — see the class doc.
    if (this.lastSummary) {
      this.send(ws, { type: "git-diff-summary", summary: this.lastSummary });
      return;
    }
    if (!this.inFlight) this.signal();
  }

  remove(ws: ClientSocket): void {
    this.subscribers.delete(ws);
  }

  // Re-send the cached summary to a subscriber once it promotes out of the
  // pending hold, so the ambient overlay is guaranteed populated on the
  // now-live client. A summary pushed while the client was pending can be
  // wiped by a `cwd` frame (the client nulls its summary on a cwd change);
  // replaying after the promote flush lands past that reset. No-op when no
  // summary is cached yet — the in-flight compute broadcasts on completion
  // and reaches the now-live subscriber.
  replayLastSummary(ws: ClientSocket): void {
    if (!this.lastSummary) return;
    this.send(ws, { type: "git-diff-summary", summary: this.lastSummary });
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

  // Push a freshly-detected PR to every tab in this cwd. Called by the
  // /api/git/branches/pr endpoint after it recomputes the PR, so a remote
  // state change one tab observed reaches siblings sharing the directory.
  broadcastPr(pr: GitBranchPr | null): void {
    const payload: ServerToClientMessage = { type: "git-branch-pr", pr };
    for (const ws of this.subscribers) this.send(ws, payload);
  }

  private readonly run = async (): Promise<void> => {
    try {
      // The working tree changed, so any cached full-diff pass for this cwd is
      // stale — drop it before re-reading the summary so the viewer's next
      // per-file fetch rebuilds against the new tree.
      invalidateGitDiffCache(this.cwd);
      const summary = await getGitDiffSummary(this.cwd);
      this.lastSummary = summary;
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
