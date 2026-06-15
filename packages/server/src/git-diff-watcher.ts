import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { GIT_DIRTY_THROTTLE_MS } from "./constants.js";

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

interface GitDiffWatcherEvents {
  "git-dirty": [];
  "git-refs-change": [];
}

export class GitDiffWatcher extends EventEmitter<GitDiffWatcherEvents> {
  private watchers: fs.FSWatcher[] = [];
  private throttleTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private gitDir: string | null = null;
  private lastHeadSha: string | null = null;

  start(cwd: string): void {
    this.stop();

    this.lastHeadSha = null;
    const result = resolveGitDir(cwd);
    if (!result) return;
    const { gitDir, repoRoot } = result;
    this.gitDir = gitDir;
    this.lastHeadSha = this.readHeadSha();

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
    if (!this.disposed) {
      this.emit("git-dirty");
      this.emitRefsChangeIfNeeded();
    }
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
    }, GIT_DIRTY_THROTTLE_MS);
    this.throttleTimer.unref?.();
  }

  private emitRefsChangeIfNeeded(): void {
    const current = this.readHeadSha();
    if (current === null || current === this.lastHeadSha) return;
    this.lastHeadSha = current;
    this.emit("git-refs-change");
  }

  private readHeadSha(): string | null {
    if (!this.gitDir) return null;
    try {
      const headContent = fs.readFileSync(path.join(this.gitDir, "HEAD"), "utf8").trim();
      const match = /^ref:\s*(.+)$/.exec(headContent);
      if (!match) return headContent.length >= 40 ? headContent : null;
      const refPath = path.join(this.gitDir, match[1]);
      const sha = fs.readFileSync(refPath, "utf8").trim();
      return sha.length >= 40 ? sha : null;
    } catch {
      return null;
    }
  }
}
