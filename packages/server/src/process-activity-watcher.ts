import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

export interface ProcessActivityWatcherEvents {
  // Emitted (debounced per cwd) after a watched program's shim overwrote its
  // activity file with the shell's $PWD. `program` is the activity filename
  // (the binary name); `cwd` is the directory the command ran in.
  activity: [program: string, cwd: string];
}

// Minimal handle the watcher needs; fs.FSWatcher satisfies it.
interface WatchHandle {
  close: () => void;
  unref?: () => void;
}

type WatchFn = (
  target: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | null) => void,
) => WatchHandle;

export interface ProcessActivityWatcherOptions {
  // Directory holding one activity file per watched program (named for the
  // program). The shim overwrites <activityDir>/<program> with $PWD on each
  // invocation; this watcher reacts to that write.
  activityDir: string;
  // Program names (activity filenames) to react to. Other writes inside the
  // dir are ignored.
  programs: readonly string[];
  // Quiet period (ms) after the last write for a given cwd before emitting —
  // coalesces a burst (e.g. `gh pr merge && gh pr checks`) into one refresh.
  debounceMs: number;
  // Watch factory; defaults to fs.watch. Injectable so tests drive synthetic
  // events deterministically instead of waiting on real filesystem timing.
  watch?: WatchFn;
  // Reads the cwd out of an activity file. Injectable so tests don't depend on
  // real disk writes. Defaults to reading + trimming the file (null on any
  // failure, e.g. the file is mid-write or absent).
  readCwd?: (file: string) => string | null;
}

// Event-driven detection of short-lived CLI invocations (e.g. `gh`) that the
// process-tree walker can't reliably catch — they exit before a `ps` snapshot
// can observe them. Each watched program's PATH shim overwrites its activity
// file with the shell's $PWD after the real binary exits; this watcher keeps
// one fs.watch on the activity dir (no polling), filters to the watched
// filenames, and emits a per-cwd-debounced `activity` event. Single-file
// overwrite means zero accumulation and no housekeeping; the rare cost is that
// near-simultaneous invocations in different cwds may coalesce to the latest
// cwd (self-correcting: the next signal or git-dirty refreshes the missed one).
export class ProcessActivityWatcher extends EventEmitter<ProcessActivityWatcherEvents> {
  private readonly activityDir: string;
  private readonly programSet: ReadonlySet<string>;
  private readonly debounceMs: number;
  private readonly watch: WatchFn;
  private readonly readCwd: (file: string) => string | null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private handle: WatchHandle | null = null;
  private disposed = false;

  constructor(options: ProcessActivityWatcherOptions) {
    super();
    this.activityDir = options.activityDir;
    this.programSet = new Set(options.programs);
    this.debounceMs = options.debounceMs;
    this.watch =
      options.watch ??
      ((target, watchOptions, listener) =>
        fs.watch(target, watchOptions, (event, filename) => listener(event, filename)));
    this.readCwd =
      options.readCwd ??
      ((file) => {
        try {
          const content = fs.readFileSync(file, "utf8").trim();
          return content.length > 0 ? content : null;
        } catch {
          return null;
        }
      });

    if (this.programSet.size === 0) return;
    // Only ensure the dir exists for the real fs.watch path — an injected
    // (test) watch never touches the filesystem, so a virtual target is fine.
    const useDefaultWatch = options.watch === undefined;
    try {
      if (useDefaultWatch) fs.mkdirSync(this.activityDir, { recursive: true, mode: 0o700 });
      this.handle = this.watch(this.activityDir, { recursive: false }, (event, filename) =>
        this.onFsEvent(event, filename),
      );
      this.handle.unref?.();
    } catch {
      // dir not watchable right now — no detection until the daemon restarts.
    }
  }

  private onFsEvent(_event: string, filename: string | null): void {
    if (this.disposed || filename === null || !this.programSet.has(filename)) return;
    const cwd = this.readCwd(path.join(this.activityDir, filename));
    if (!cwd) return;
    // Per-(program, cwd) debounce: a burst in one directory collapses to one
    // emission, while a concurrent signal for a different cwd (or a different
    // watched program) still fires on its own.
    const debounceKey = `${filename}\0${cwd}`;
    const existingTimer = this.timers.get(debounceKey);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.timers.delete(debounceKey);
      if (this.disposed) return;
      this.emit("activity", filename, cwd);
    }, this.debounceMs);
    timer.unref?.();
    this.timers.set(debounceKey, timer);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    try {
      this.handle?.close();
    } catch {
      /* already closed */
    }
    this.handle = null;
    this.removeAllListeners();
  }
}
