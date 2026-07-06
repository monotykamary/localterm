import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { Automation } from "./types.js";
import {
  GIT_DIFF_WATCHER_EVENT_NAMES,
  buildGitSnapshot,
  classifyGitChanges,
  resolveGitDir,
  type GitRefEventName,
  type GitSnapshot,
} from "./git-diff-watcher.js";
import { Throttle } from "./utils/throttle.js";

interface AutomationGitWatcherEvents {
  // Emitted (per affected repo) once a ref change under a watched cwd tree is
  // classified. `repoRoot` is the discovered repo's working-tree root (the
  // directory containing its `.git`), scoped so SessionEventManager's
  // isCwdMatch reaches every event automation whose cwd is it or an ancestor.
  refEvent: [eventName: GitRefEventName, repoRoot: string];
}

interface WatchHandle {
  close: () => void;
  unref?: () => void;
}

type WatchFn = (
  target: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | null) => void,
) => WatchHandle;

interface AutomationGitWatcherOptions {
  // Per-repo classify throttle: a leading edge emits on the first event of a
  // burst, a trailing flush re-snapshots so the final (post-commit) state is
  // always classified — mirrors GitDiffWatcher. Reuses GIT_DIRTY_THROTTLE_MS.
  throttleMs: number;
  // Watch factory; defaults to fs.watch. Injectable so tests fire synthetic
  // events deterministically instead of waiting on real filesystem timing.
  watch?: WatchFn;
}

interface RepoState {
  repoRoot: string;
  snapshot: GitSnapshot | null;
  throttle: Throttle;
}

interface WatchEntry {
  handle: WatchHandle | null;
  // Repos known under this cwd, keyed by gitDir. Seeded eagerly at arm time for
  // repos that already exist (so the first change after arming classifies
  // against a real baseline instead of the post-change state), and grown
  // lazily as fs events surface repos created after the watch started. A
  // repo whose `.git` is a `gitdir:` file (worktree/submodule) resolves to the
  // shared gitDir, so it shares one entry.
  repos: Map<string, RepoState>;
}

// The selectable git ref events an event automation can match. Shared with the
// per-session GitDiffWatcher table, minus the internal `git-dirty` (deliberately
// not user-selectable — see schemas.ts).
const GIT_REF_EVENT_NAMES: readonly GitRefEventName[] = GIT_DIFF_WATCHER_EVENT_NAMES.filter(
  (name): name is GitRefEventName => name !== "git-dirty",
);

// The baseline for a repo that appears out of nothing (a brand-new repo created
// after the watch armed). Compared via classifyGitChanges against its first
// observed snapshot so the refs that "appeared" (a branch, HEAD, …) are emitted
// even when `git init` + first commit land in one fs.watch batch — there is no
// pre-state to diff against, so the empty tree is the pre-state.
const EMPTY_GIT_SNAPSHOT: GitSnapshot = {
  head: null,
  refs: new Map(),
  special: {
    fetchHead: null,
    origHead: null,
    mergeHead: null,
    cherryPickHead: null,
    rebaseMergeExists: false,
    rebaseApplyExists: false,
  },
};

const hasGitEvent = (automation: Automation): boolean => {
  if (automation.trigger.kind !== "event") return false;
  const { events } = automation.trigger;
  return GIT_REF_EVENT_NAMES.some((event) => events.includes(event));
};

// A path is under a repo's `.git` if it contains `/.git/` or ends in `/.git`.
// Cheap substring reject for the working-tree/build noise (source edits,
// node_modules churn) that dominates a recursive watch over a container of
// repos — only `.git`-adjacent paths reach the stat-ing resolveGitDir.
const isUnderGitDir = (absolutePath: string): boolean => {
  const sep = path.sep;
  return absolutePath.includes(`${sep}.git${sep}`) || absolutePath.endsWith(`${sep}.git`);
};

// Dependency caches (npm/yarn git-dep clones land a `.git` under node_modules)
// are never projects an automation means to watch. Excluding the whole
// `node_modules` subtree avoids spurious runs from installs; the per-session
// GitDiffWatcher sidesteps this by only ever classifying its own repo, but this
// watcher resolves the specific affected repo from the event path.
const isInsideNodeModules = (absolutePath: string): boolean =>
  absolutePath.includes(`${path.sep}node_modules${path.sep}`);

// Daemon-global, session-independent git detection for event automations.
// The per-session GitDiffWatcher only fires when a localterm PTY is live in the
// affected repo: a commit from a non-localterm process (a headless agent, an
// editor, an SSH session) or in a repo with no open tab produces no event.
// This watcher arms one recursive fs.watch per watched cwd — the unique cwds
// of enabled, active event automations that select at least one git event —
// and on `.git` changes classifies the affected repo, reusing buildGitSnapshot
// + classifyGitChanges, emitting ref events that feed SessionEventManager
// exactly like the per-session path. Source-agnostic: catches any git state
// change regardless of which process caused it (path-shim and shell-hook gaps
// alike).
//
// Existing repos under the cwd are eager-seeded when the watch arms (a walk
// that stops descending at the first `.git` and skips `node_modules`, so it
// visits only the container and repo roots — milliseconds even for a tree of
// many repos). That baseline lets the first change after arming classify
// correctly (a benign `.git` write from `git status`/`git reflog` produces no
// event, and a commit on an existing branch emits `git-commit`, not a spurious
// `git-branch-change`). Repos created after arming are discovered lazily: a
// bare `git init` seeds the empty tree silently, and a repo that appears with
// refs already present (e.g. `git init` + first commit landing in one fs.watch
// batch) emits the refs that "appeared" against the empty baseline.
export class AutomationGitWatcher extends EventEmitter<AutomationGitWatcherEvents> {
  private readonly entries = new Map<string, WatchEntry>();
  private readonly watch: WatchFn;
  private readonly throttleMs: number;
  private disposed = false;

  constructor(options: AutomationGitWatcherOptions) {
    super();
    this.throttleMs = options.throttleMs;
    this.watch =
      options.watch ??
      ((target, watchOptions, listener) =>
        fs.watch(target, watchOptions, (event, filename) => listener(event, filename)));
  }

  // Reconcile live watchers with the desired set of event-automation cwds.
  // Idempotent and cheap, so it can be called after any automation mutation.
  sync(automations: Automation[]): void {
    if (this.disposed) return;
    const desired = new Set<string>();
    for (const automation of automations) {
      if (!automation.enabled) continue;
      if (automation.lifecycle !== "active") continue;
      if (!hasGitEvent(automation)) continue;
      desired.add(path.resolve(automation.cwd));
    }
    for (const cwd of [...this.entries.keys()]) {
      if (!desired.has(cwd)) this.stopEntry(cwd);
    }
    for (const cwd of desired) {
      if (!this.entries.has(cwd)) this.startEntry(cwd);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const cwd of [...this.entries.keys()]) this.stopEntry(cwd);
    this.removeAllListeners();
  }

  private startEntry(cwd: string): void {
    const entry: WatchEntry = { handle: null, repos: new Map() };
    try {
      const handle = this.watch(cwd, { recursive: true }, (event, filename) =>
        this.onFsEvent(cwd, event, filename),
      );
      handle.unref?.();
      entry.handle = handle;
    } catch {
      // cwd doesn't exist, or recursive watch is unavailable / exceeds inotify
      // limits on this platform. Eager-seeding still runs below so existing
      // repos get a baseline; the per-session GitDiffWatcher covers live
      // changes, and a later sync (after the dir exists or limits free) retries
      // the watch.
    }
    this.discoverExistingRepos(entry, cwd);
    this.entries.set(cwd, entry);
  }

  // Walk the cwd tree and seed a baseline snapshot for every repo already on
  // disk, so the first change after arming classifies against a real pre-state.
  // Stops descending the moment a `.git` is found (a repo's working tree is
  // covered for *changes* by the recursive fs.watch; nesting into it would
  // re-traverse the 20k-dir source tree for no benefit) and never enters
  // `node_modules`, so it visits only the container and repo roots.
  private discoverExistingRepos(entry: WatchEntry, cwd: string): void {
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some((dirent) => dirent.name === ".git")) {
        const resolved = resolveGitDir(dir);
        if (resolved) this.seedRepo(entry, resolved.gitDir, resolved.repoRoot);
        return;
      }
      for (const child of entries) {
        if (!child.isDirectory()) continue;
        if (child.name === "node_modules") continue;
        walk(path.join(dir, child.name));
      }
    };
    walk(cwd);
  }

  private onFsEvent(cwd: string, _event: string, filename: string | null): void {
    if (this.disposed || filename === null) return;
    const entry = this.entries.get(cwd);
    if (!entry) return;
    // fs.watch delivers `filename` relative to the watched cwd; resolve to an
    // absolute path. (If a platform delivers an absolute filename, resolve
    // returns it as-is.)
    const absolutePath = path.resolve(cwd, filename);
    if (!isUnderGitDir(absolutePath)) return;
    if (isInsideNodeModules(absolutePath)) return;
    const resolved = resolveGitDir(path.dirname(absolutePath));
    if (!resolved) return;
    this.route(entry, resolved.gitDir, resolved.repoRoot);
  }

  private route(entry: WatchEntry, gitDir: string, repoRoot: string): void {
    let state = entry.repos.get(gitDir);
    if (!state) {
      // A repo the eager seed didn't find — created after arming, or nested
      // under another repo's working tree. Seed it now. If it already has refs
      // (e.g. `git init` + first commit landed in one fs.watch batch), there is
      // no pre-state to diff, so emit the refs that appeared against the empty
      // baseline; a bare `git init` (no refs) seeds silently.
      state = this.seedRepo(entry, gitDir, repoRoot);
      if (state.snapshot && state.snapshot.refs.size > 0) {
        for (const eventName of classifyGitChanges(EMPTY_GIT_SNAPSHOT, state.snapshot)) {
          this.emit("refEvent", eventName, repoRoot);
        }
      }
    }
    state.throttle.trigger();
  }

  private seedRepo(entry: WatchEntry, gitDir: string, repoRoot: string): RepoState {
    const state: RepoState = {
      repoRoot,
      snapshot: buildGitSnapshot(gitDir),
      throttle: new Throttle(() => this.classify(entry, gitDir), this.throttleMs),
    };
    entry.repos.set(gitDir, state);
    return state;
  }

  private classify(entry: WatchEntry, gitDir: string): void {
    if (this.disposed) return;
    const state = entry.repos.get(gitDir);
    if (!state) return;
    const current = buildGitSnapshot(gitDir);
    const previous = state.snapshot;
    state.snapshot = current;
    if (!previous || !current) return;
    for (const eventName of classifyGitChanges(previous, current)) {
      this.emit("refEvent", eventName, state.repoRoot);
    }
  }

  private stopEntry(cwd: string): void {
    const entry = this.entries.get(cwd);
    if (!entry) return;
    try {
      entry.handle?.close();
    } catch {
      /* already closed */
    }
    for (const state of entry.repos.values()) state.throttle.dispose();
    entry.repos.clear();
    this.entries.delete(cwd);
  }
}
