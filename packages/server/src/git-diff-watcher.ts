import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { GIT_DIRTY_THROTTLE_MS } from "./constants.js";
import { Throttle } from "./utils/throttle.js";

interface GitDirResult {
  gitDir: string;
  repoRoot: string;
}

const resolveGitDir = (cwd: string): GitDirResult | null => {
  let current = path.resolve(cwd);
  while (true) {
    const indicator = path.join(current, ".git");
    try {
      const stat = fs.statSync(indicator);
      if (stat.isDirectory()) return { gitDir: indicator, repoRoot: current };
      if (stat.isFile()) {
        const content = fs.readFileSync(indicator, "utf8").trim();
        const match = /^gitdir:\s*(.+)$/m.exec(content);
        if (match) {
          const resolved = path.resolve(current, match[1]);
          try {
            if (fs.statSync(resolved).isDirectory()) return { gitDir: resolved, repoRoot: current };
          } catch {
            /* gitdir path is stale or inaccessible */
          }
        }
      }
    } catch {
      /* .git doesn't exist here — walk up */
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};

export const GIT_DIFF_WATCHER_EVENT_NAMES = [
  "git-dirty",
  "git-head-change",
  "git-branch-change",
  "git-tag-change",
  "git-remote-change",
  "git-stash-change",
  "git-commit",
  "git-checkout",
  "git-reset",
  "git-merge",
  "git-rebase",
  "git-cherry-pick",
  "git-fetch",
  "git-stash",
  "git-tag",
] as const satisfies [string, ...string[]];

export type GitDiffWatcherEventName = (typeof GIT_DIFF_WATCHER_EVENT_NAMES)[number];

export type GitDiffWatcherEvents = {
  [K in GitDiffWatcherEventName]: [];
};

export type GitRefEventName = Exclude<GitDiffWatcherEventName, "git-dirty">;

export interface GitSpecialSnapshot {
  fetchHead: string | null;
  origHead: string | null;
  mergeHead: string | null;
  cherryPickHead: string | null;
  rebaseMergeExists: boolean;
  rebaseApplyExists: boolean;
}

export interface GitSnapshot {
  head: string | null;
  refs: Map<string, string>;
  special: GitSpecialSnapshot;
}

const readFileString = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
};

const directoryExists = (dirPath: string): boolean => {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
};

export const buildGitSnapshot = (gitDir: string): GitSnapshot | null => {
  if (!directoryExists(gitDir)) return null;
  const refsDir = path.join(gitDir, "refs");
  const refs = new Map<string, string>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        try {
          const sha = fs.readFileSync(fullPath, "utf8").trim();
          const relPath = path.relative(refsDir, fullPath);
          refs.set(relPath, sha);
        } catch {
          /* ref file deleted between readdir and read */
        }
      }
    }
  };
  walk(refsDir);

  return {
    head: readFileString(path.join(gitDir, "HEAD")),
    refs,
    special: {
      fetchHead: readFileString(path.join(gitDir, "FETCH_HEAD")),
      origHead: readFileString(path.join(gitDir, "ORIG_HEAD")),
      mergeHead: readFileString(path.join(gitDir, "MERGE_HEAD")),
      cherryPickHead: readFileString(path.join(gitDir, "CHERRY_PICK_HEAD")),
      rebaseMergeExists: directoryExists(path.join(gitDir, "rebase-merge")),
      rebaseApplyExists: directoryExists(path.join(gitDir, "rebase-apply")),
    },
  };
};

interface GitChanges {
  head: boolean;
  branch: boolean;
  // Existing heads/ ref changed SHA; unlike `branch` this excludes created/deleted
  // refs (worktree add -b, branch -d), so it gates op-level classification.
  branchAdvanced: boolean;
  tag: boolean;
  remote: boolean;
  stash: boolean;
  fetchHead: boolean;
  origHead: boolean;
  mergeHead: boolean;
  cherryPickHead: boolean;
  rebaseMerge: boolean;
  rebaseApply: boolean;
}

const computeGitChanges = (previous: GitSnapshot, current: GitSnapshot): GitChanges => {
  const namespaceChanged = (prefix: string): boolean => {
    const previousKeys = [...previous.refs.keys()].filter((key) => key.startsWith(prefix));
    const currentKeys = [...current.refs.keys()].filter((key) => key.startsWith(prefix));
    if (previousKeys.length !== currentKeys.length) return true;
    for (const key of previousKeys) {
      if (previous.refs.get(key) !== current.refs.get(key)) return true;
    }
    return false;
  };

  const refChanged = (name: string): boolean => previous.refs.get(name) !== current.refs.get(name);
  const existingRefAdvanced = (prefix: string): boolean => {
    for (const [key, previousValue] of previous.refs) {
      if (!key.startsWith(prefix)) continue;
      const currentValue = current.refs.get(key);
      if (currentValue !== undefined && currentValue !== previousValue) return true;
    }
    return false;
  };
  const specialChanged = (key: keyof GitSpecialSnapshot): boolean =>
    previous.special[key] !== current.special[key];

  return {
    head: previous.head !== current.head,
    branch: namespaceChanged("heads/"),
    branchAdvanced: existingRefAdvanced("heads/"),
    tag: namespaceChanged("tags/"),
    remote: namespaceChanged("remotes/"),
    stash: refChanged("stash"),
    fetchHead: specialChanged("fetchHead"),
    origHead: specialChanged("origHead"),
    mergeHead: specialChanged("mergeHead"),
    cherryPickHead: specialChanged("cherryPickHead"),
    rebaseMerge: specialChanged("rebaseMergeExists"),
    rebaseApply: specialChanged("rebaseApplyExists"),
  };
};

export const classifyGitChanges = (
  previous: GitSnapshot,
  current: GitSnapshot,
): GitRefEventName[] => {
  const changes = computeGitChanges(previous, current);
  const events: GitRefEventName[] = [];

  if (changes.head) events.push("git-head-change");
  if (changes.branch) events.push("git-branch-change");
  if (changes.tag) events.push("git-tag-change");
  if (changes.remote) events.push("git-remote-change");
  if (changes.stash) events.push("git-stash-change");

  const branchSpecialStateBefore =
    previous.special.mergeHead ||
    previous.special.cherryPickHead ||
    previous.special.rebaseMergeExists ||
    previous.special.rebaseApplyExists;

  if (changes.branchAdvanced) {
    if (previous.special.mergeHead) events.push("git-merge");
    else if (previous.special.cherryPickHead) events.push("git-cherry-pick");
    else if (previous.special.rebaseMergeExists || previous.special.rebaseApplyExists)
      events.push("git-rebase");
    else if (changes.origHead && !branchSpecialStateBefore) events.push("git-reset");
    else events.push("git-commit");
  } else if (changes.remote || changes.fetchHead) {
    events.push("git-fetch");
  }

  if (changes.tag) events.push("git-tag");
  if (changes.stash) events.push("git-stash");
  if (changes.head && !changes.branch) events.push("git-checkout");
  if (changes.origHead && !changes.branch && !changes.head) events.push("git-reset");

  return events;
};

export class GitDiffWatcher extends EventEmitter<GitDiffWatcherEvents> {
  private watchers: fs.FSWatcher[] = [];
  private throttle: Throttle | null = null;
  private disposed = false;
  private gitDir: string | null = null;
  private lastSnapshot: GitSnapshot | null = null;

  start(cwd: string): void {
    this.stop();

    this.lastSnapshot = null;
    const result = resolveGitDir(cwd);
    if (!result) return;
    const { gitDir, repoRoot } = result;
    this.gitDir = gitDir;
    this.lastSnapshot = buildGitSnapshot(gitDir);
    // Leading + trailing throttle: emit `git-dirty` on the first fs event of a
    // burst, then once more after the burst settles so the final tree state is
    // always signaled (a burst often starts mid-rename, so the leading snapshot
    // alone can leave the diff cache stale).
    this.throttle = new Throttle(() => {
      this.emit("git-dirty");
      this.emitRefEventsIfNeeded();
    }, GIT_DIRTY_THROTTLE_MS);

    const watch = (target: string, options?: fs.WatchOptions | BufferEncoding | null) => {
      try {
        const watcher = fs.watch(target, options ?? {}, (event: string) => {
          if (this.disposed) return;
          if (event === "change" || event === "rename") {
            this.throttledEmit();
          }
        });
        this.watchers.push(watcher);
      } catch {
        /* target doesn't exist or isn't watchable */
      }
    };

    watch(gitDir);
    watch(repoRoot, { recursive: true });

    const refsDir = path.join(gitDir, "refs");
    try {
      if (fs.statSync(refsDir).isDirectory()) watch(refsDir, { recursive: true });
    } catch {
      /* refs dir may not exist in a bare or unusual repo */
    }
  }

  stop(): void {
    this.throttle?.dispose();
    this.throttle = null;
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
    }
    this.watchers = [];
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.removeAllListeners();
  }

  private throttledEmit(): void {
    this.throttle?.trigger();
  }

  private emitRefEventsIfNeeded(): void {
    if (!this.gitDir) return;
    const current = buildGitSnapshot(this.gitDir);
    const previous = this.lastSnapshot;
    this.lastSnapshot = current;
    if (!previous || !current) return;

    const events = classifyGitChanges(previous, current);
    for (const eventName of events) {
      this.emit(eventName);
    }
  }
}
