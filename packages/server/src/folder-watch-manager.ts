import { EventEmitter } from "node:events";
import fs from "node:fs";
import picomatch from "picomatch";
import type { Automation } from "./types.js";

interface FolderWatchManagerEvents {
  due: [automation: Automation];
}

// Minimal handle the manager needs from a watcher; fs.FSWatcher satisfies it.
interface WatchHandle {
  close: () => void;
  unref?: () => void;
}

// Arms a native (or, in tests, fake) watch on a directory; the listener is
// invoked on any change inside it.
type WatchFn = (
  target: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | null) => void,
) => WatchHandle;

interface FolderWatchManagerOptions {
  // Quiet period (ms) after the last filesystem event before firing — coalesces
  // a burst (one editor save emits several events; a build emits thousands) into
  // a single run.
  debounceMs: number;
  // Grace period (ms) after a watch-triggered run finishes during which new
  // events are dropped. Prevents the command's own side effects (e.g. deleting
  // the source file after conversion) from retriggering the automation.
  postRunGraceMs: number;
  // True while a run for this automation is still launching/running. Used to
  // skip overlapping launches (which also stops a command that writes back into
  // the watched tree from re-triggering itself mid-run).
  isRunInFlight: (automationId: string) => boolean;
  // The latest stored automation, re-read at fire time so an edit made during
  // the debounce window (disabled, limit reached, switched to a schedule) is
  // honored instead of the snapshot captured when the watch started.
  getAutomation: (automationId: string) => Automation | null;
  // Watch factory; defaults to fs.watch. Injectable so tests drive synthetic
  // events deterministically instead of waiting on real filesystem timing.
  watch?: WatchFn;
}

interface WatchEntry {
  watchers: WatchHandle[];
  // recursive flag + cwd + filter; the watch is torn down and rebuilt when any
  // of these change.
  signature: string;
  debounceTimer: NodeJS.Timeout | null;
  // Set when a watch-triggered run finishes; cleared after postRunGraceMs.
  // Events arriving during the grace window are dropped at onFsEvent time so
  // the command's side effects (e.g. deleting the source file) don't
  // re-trigger the automation.
  postRunGraceTimer: NodeJS.Timeout | null;
  postRunGraceActive: boolean;
}

const signatureOf = (automation: Automation): string =>
  automation.trigger.kind === "watch"
    ? `${automation.trigger.recursive}:${automation.cwd}:${automation.trigger.filter ?? ""}`
    : automation.cwd;

// Event-driven folder triggers for automations: one native fs.watch per "watch"
// automation, on its cwd. No polling — mirrors GitDiffWatcher. A burst of events
// is coalesced by a trailing debounce, and a launch is suppressed while a prior
// run is still in-flight (at most one run per automation at a time).
export class FolderWatchManager extends EventEmitter<FolderWatchManagerEvents> {
  private readonly entries = new Map<string, WatchEntry>();
  private readonly watch: WatchFn;
  private disposed = false;

  constructor(private readonly options: FolderWatchManagerOptions) {
    super();
    this.watch =
      options.watch ??
      ((target, watchOptions, listener) =>
        fs.watch(target, watchOptions, (event, filename) => listener(event, filename)));
  }

  // Reconcile the live watchers with the desired set (enabled + active + watch).
  // Idempotent and cheap, so it can be called after any automation mutation.
  sync(automations: Automation[]): void {
    if (this.disposed) return;
    const desired = new Map<string, Automation>();
    for (const automation of automations) {
      if (!automation.enabled) continue;
      if (automation.lifecycle !== "active") continue;
      if (automation.trigger.kind !== "watch") continue;
      desired.set(automation.id, automation);
    }
    // Stop watchers that are no longer desired or whose target changed.
    for (const [id, entry] of this.entries) {
      const automation = desired.get(id);
      if (!automation || signatureOf(automation) !== entry.signature) this.stopEntry(id);
    }
    // Start watchers for newly-desired (or just-rebuilt) automations.
    for (const [id, automation] of desired) {
      if (!this.entries.has(id)) this.startEntry(automation);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.entries.keys()]) this.stopEntry(id);
    this.removeAllListeners();
  }

  private startEntry(automation: Automation): void {
    if (automation.trigger.kind !== "watch") return;
    const { recursive } = automation.trigger;
    const entry: WatchEntry = {
      watchers: [],
      signature: signatureOf(automation),
      debounceTimer: null,
      postRunGraceTimer: null,
      postRunGraceActive: false,
    };
    try {
      const watcher = this.watch(automation.cwd, { recursive }, (event, filename) => {
        this.onFsEvent(automation.id, event, filename);
      });
      // Don't keep the daemon alive on the watch alone (the http server does).
      watcher.unref?.();
      entry.watchers.push(watcher);
    } catch {
      // cwd doesn't exist or isn't watchable right now — leave the entry empty;
      // a later sync (after the directory is fixed) retries.
    }
    this.entries.set(automation.id, entry);
  }

  private onFsEvent(automationId: string, _event: string, filename: string | null): void {
    if (this.disposed) return;
    const entry = this.entries.get(automationId);
    if (!entry) return;
    // Post-run grace: drop events while the command's side effects are still
    // settling (e.g. the source file being deleted after conversion).
    if (entry.postRunGraceActive) return;
    // When a filter is set, only debounce events whose filename matches the
    // pattern. Events without a filename (some platforms emit null) pass
    // through unfiltered so watch automations without a filter still work.
    const automation = this.options.getAutomation(automationId);
    if (
      automation?.trigger.kind === "watch" &&
      automation.trigger.filter &&
      filename !== null &&
      !picomatch(automation.trigger.filter)(filename)
    ) {
      return;
    }
    if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      this.fire(automationId);
    }, this.options.debounceMs);
    entry.debounceTimer.unref?.();
  }

  // Called when a watch-triggered run finishes (completed/failed). Arms the
  // post-run grace window so side-effect events (file deletions, etc.) are
  // dropped instead of retriggering the automation.
  notifyRunFinished(automationId: string): void {
    if (this.disposed) return;
    const entry = this.entries.get(automationId);
    if (!entry) return;
    if (entry.postRunGraceTimer !== null) clearTimeout(entry.postRunGraceTimer);
    entry.postRunGraceActive = true;
    entry.postRunGraceTimer = setTimeout(() => {
      entry.postRunGraceActive = false;
      entry.postRunGraceTimer = null;
    }, this.options.postRunGraceMs);
    entry.postRunGraceTimer.unref?.();
  }

  private fire(automationId: string): void {
    if (this.disposed) return;
    if (!this.entries.has(automationId)) return;
    // No overlap: drop this change if a run is still in-flight. The next event
    // after it settles re-arms, so writes made *during* the run are ignored.
    if (this.options.isRunInFlight(automationId)) return;
    // Re-read live state — the automation may have been disabled, hit its limit,
    // or switched to a schedule while the debounce was pending.
    const automation = this.options.getAutomation(automationId);
    if (!automation || !automation.enabled || automation.lifecycle !== "active") return;
    if (automation.trigger.kind !== "watch") return;
    this.emit("due", automation);
  }

  private stopEntry(automationId: string): void {
    const entry = this.entries.get(automationId);
    if (!entry) return;
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    if (entry.postRunGraceTimer !== null) {
      clearTimeout(entry.postRunGraceTimer);
      entry.postRunGraceTimer = null;
      entry.postRunGraceActive = false;
    }
    for (const watcher of entry.watchers) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
    }
    this.entries.delete(automationId);
  }
}
