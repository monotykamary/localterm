import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { GIT_DIRTY_THROTTLE_MS } from "./constants.js";

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
  private throttleTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  start(cwd: string): void {
    this.stop();

    const gitDir = resolveGitDir(cwd);
    if (!gitDir) return;

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
    watch(cwd, { recursive: true });

    const refsDir = path.join(gitDir, "refs");
    try {
      if (fs.statSync(refsDir).isDirectory()) watch(refsDir);
    } catch {
      /* refs dir may not exist in a bare or unusual repo */
    }
  }

  stop(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
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

  private throttledEmit(): void {
    if (this.throttleTimer !== null) return;
    if (!this.disposed) this.emit("git-dirty");
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
    }, GIT_DIRTY_THROTTLE_MS);
    this.throttleTimer.unref?.();
  }
}
