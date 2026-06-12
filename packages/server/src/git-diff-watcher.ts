import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { GIT_DIRTY_DEBOUNCE_MS, WORKTREE_DIRTY_DEBOUNCE_MS } from "./constants.js";

const resolveGitDir = (cwd: string): string | null => {
  const indicator = path.join(cwd, ".git");
  try {
    const stat = fs.statSync(indicator);
    if (stat.isDirectory()) return indicator;
    if (stat.isFile()) {
      const content = fs.readFileSync(indicator, "utf8").trim();
      const match = /^gitdir:\s*(.+)$/m.exec(content);
      if (match) {
        const resolved = path.resolve(cwd, match[1]);
        try {
          if (fs.statSync(resolved).isDirectory()) return resolved;
        } catch {
          /* gitdir path is stale or inaccessible */
        }
      }
    }
  } catch {
    /* not a git repo or .git is missing */
  }
  return null;
};

interface GitDiffWatcherEvents {
  "git-dirty": [];
}

export class GitDiffWatcher extends EventEmitter<GitDiffWatcherEvents> {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  start(cwd: string): void {
    this.stop();

    const gitDir = resolveGitDir(cwd);
    if (!gitDir) return;

    const gitWatchTargets = [gitDir];
    const refsDir = path.join(gitDir, "refs");
    try {
      if (fs.statSync(refsDir).isDirectory()) gitWatchTargets.push(refsDir);
    } catch {
      /* refs dir may not exist in a bare or unusual repo */
    }

    for (const target of gitWatchTargets) {
      try {
        const watcher = fs.watch(target, (event) => {
          if (this.disposed) return;
          if (event === "change" || event === "rename") {
            this.scheduleEmit(GIT_DIRTY_DEBOUNCE_MS);
          }
        });
        this.watchers.push(watcher);
      } catch {
        /* target doesn't exist or isn't watchable */
      }
    }

    try {
      const watcher = fs.watch(cwd, (event) => {
        if (this.disposed) return;
        if (event === "change" || event === "rename") {
          this.scheduleEmit(WORKTREE_DIRTY_DEBOUNCE_MS);
        }
      });
      this.watchers.push(watcher);
    } catch {
      /* cwd doesn't exist or isn't watchable */
    }
  }

  stop(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
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

  private scheduleEmit(delayMs: number): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.disposed) this.emit("git-dirty");
    }, delayMs);
    this.debounceTimer.unref?.();
  }
}
