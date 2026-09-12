import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GitDiffWatcher } from "../src/git-diff-watcher.js";
import { FolderWatchManager } from "../src/folder-watch-manager.js";
import { AutomationGitWatcher } from "../src/automation-git-watcher.js";
import { ProcessActivityWatcher } from "../src/process-activity-watcher.js";
import type { Automation } from "../src/types.js";
import { FILE_WATCH_RETRY_INITIAL_MS } from "../src/constants.js";

describe("watcher owner safety", () => {
  let root: string;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    root = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-watch-safety-"));
    fs.mkdirSync(path.join(root, ".git", "refs"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(["git", "folder", "automation-git", "activity"])(
    "recovers %s watches and cancels recovery on disposal",
    async (kind) => {
      const handles: Array<EventEmitter & { close: ReturnType<typeof vi.fn> }> = [];
      const factory = vi.fn(() => {
        const handle = Object.assign(new EventEmitter(), { close: vi.fn() });
        handles.push(handle);
        return handle;
      });
      const automation = {
        id: "fixture",
        enabled: true,
        lifecycle: "active",
        cwd: root,
        trigger: { kind: "watch", recursive: true },
      } as Automation;
      let owner: { dispose: () => void };
      if (kind === "git") {
        const watcher = new GitDiffWatcher(factory);
        watcher.start(root);
        owner = watcher;
      } else if (kind === "folder") {
        const watcher = new FolderWatchManager({
          debounceMs: 1,
          postRunGraceMs: 1,
          isRunInFlight: () => false,
          getAutomation: () => automation,
          watch: factory,
        });
        watcher.sync([automation]);
        owner = watcher;
      } else if (kind === "automation-git") {
        const watcher = new AutomationGitWatcher({ throttleMs: 1, watch: factory });
        watcher.sync([
          {
            ...automation,
            trigger: { kind: "event", events: ["git-commit"] },
          },
        ]);
        owner = watcher;
      } else {
        owner = new ProcessActivityWatcher({
          activityDir: root,
          programs: ["gh"],
          debounceMs: 1,
          watch: factory,
        });
      }
      try {
        const initialCount = handles.length;
        expect(initialCount).toBeGreaterThan(0);
        for (const handle of [...handles])
          expect(() => handle.emit("error", new Error("ENOSPC"))).not.toThrow();
        await vi.advanceTimersByTimeAsync(FILE_WATCH_RETRY_INITIAL_MS);
        expect(handles).toHaveLength(initialCount * 2);
        handles.at(-1)?.emit("error", new Error("EMFILE"));
      } finally {
        owner.dispose();
      }
      await vi.advanceTimersByTimeAsync(FILE_WATCH_RETRY_INITIAL_MS * 2);
      expect(vi.getTimerCount()).toBe(0);
      for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
    },
  );
});
