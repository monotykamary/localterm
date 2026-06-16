import { EventEmitter } from "node:events";
import type { CaffeinateController } from "./caffeinate-controller.js";
import type { CaffeinatePreferencesStore } from "./caffeinate-preferences-store.js";
import {
  anySessionRunsTrigger,
  defaultSnapshotProcesses,
  type SnapshotProcesses,
} from "./caffeinate-process-match.js";
import {
  CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS,
  CAFFEINATE_AUTO_DEFAULT_COMMANDS,
  CAFFEINATE_AUTO_POKE_DEBOUNCE_MS,
} from "./constants.js";
import type { CaffeinateMode } from "./types.js";

export interface CaffeinateManagerOptions {
  controller: CaffeinateController;
  store: CaffeinatePreferencesStore;
  // Live shell pids of every session (usually SessionRegistry.pids). Automatic
  // mode only reacts to programs running under one of these.
  listSessionPids: () => number[];
  // Injectable process snapshot for tests; defaults to a real `ps` listing.
  snapshotProcesses?: SnapshotProcesses;
  // Injectable trigger defaults; defaults to the fixed recognized commands.
  defaultCommands?: readonly string[];
  // Check whether any session produced output recently. When the activity gate
  // is enabled, caffeinate only stays active while a recognized program is
  // producing output within the debounce window.
  hasRecentOutput?: (pids: readonly number[], withinMs: number) => boolean;
}

interface CaffeinateManagerEvents {
  change: [];
}

// Decides *when* the daemon's single keep-awake process runs, on top of the
// dumb CaffeinateController (which only knows start/stop). In "on" it is always
// active, in "off" never, and in "automatic" it tracks whether any recognized
// program is running in a localterm session — discovered by walking the `ps`
// process tree under each session's shell. When the activity gate is enabled
// (the default), caffeinate further requires that a recognized program is
// producing output; after CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS of silence,
// caffeinate releases. Emits `change` whenever any broadcastable field
// (mode/active/commands) moves.
//
// Automatic detection is event-driven: it never polls on a timer. A `ps`
// snapshot is taken only in response to an event — a session's foreground
// process changing, a session connecting/disconnecting, an output-activity
// change, or a mode/command change — via the debounced `pokeAuto`. (The
// foreground signal itself rides on node-pty's existing per-session foreground
// tracking, which powers the favicon and exists independently of keep-awake.)
// The activity gate is driven by a trailing-edge timer: output resets it, and
// when it finally fires (no output for the debounce window), it pokes a
// re-check.
export class CaffeinateManager extends EventEmitter<CaffeinateManagerEvents> {
  private readonly controller: CaffeinateController;
  private readonly store: CaffeinatePreferencesStore;
  private readonly listSessionPids: () => number[];
  private readonly snapshotProcesses: SnapshotProcesses;
  private readonly checkRecentOutput?: (pids: readonly number[], withinMs: number) => boolean;
  readonly defaultCommands: readonly string[];

  private autoActive = false;
  private autoTrigger: string | null = null;
  private pokeTimer: NodeJS.Timeout | null = null;
  private activityGateTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private pollQueued = false;
  private disposed = false;

  constructor(options: CaffeinateManagerOptions) {
    super();
    this.controller = options.controller;
    this.store = options.store;
    this.listSessionPids = options.listSessionPids;
    this.snapshotProcesses = options.snapshotProcesses ?? defaultSnapshotProcesses;
    this.defaultCommands = options.defaultCommands ?? CAFFEINATE_AUTO_DEFAULT_COMMANDS;
    this.checkRecentOutput = options.hasRecentOutput;

    // An unexpected death of the caffeinate process flips controller state; pass
    // that through so every tab rebroadcasts the authoritative `active`.
    this.controller.on("change", () => this.emit("change"));

    this.recompute();
    // One snapshot at startup in case a trigger is already running before any
    // event arrives; from here on detection is purely event-driven.
    if (this.mode === "automatic" && this.supported) void this.pollAuto();
  }

  get supported(): boolean {
    return this.controller.supported;
  }

  get active(): boolean {
    return this.controller.active;
  }

  get mode(): CaffeinateMode {
    return this.store.getMode();
  }

  get commands(): string[] {
    return this.store.getCommands();
  }

  get activityGate(): boolean {
    return this.store.getActivityGate();
  }

  get activeTrigger(): string | null {
    return this.autoActive ? this.autoTrigger : null;
  }

  setMode(mode: CaffeinateMode): void {
    if (this.disposed) return;
    this.store.setMode(mode);
    // Leaving automatic clears the cached detection so a later return to
    // automatic re-derives it from scratch rather than trusting a stale flag.
    if (mode !== "automatic") {
      this.autoActive = false;
      this.autoTrigger = null;
      this.clearActivityGateTimer();
    }
    this.recompute();
    if (mode === "automatic" && this.supported) void this.pollAuto();
    this.emit("change");
  }

  setCommands(commands: readonly string[]): void {
    if (this.disposed) return;
    this.store.setCommands(commands);
    // The trigger set changed; re-derive automatic detection immediately.
    if (this.mode === "automatic" && this.supported) void this.pollAuto();
    this.emit("change");
  }

  setActivityGate(enabled: boolean): void {
    if (this.disposed) return;
    this.store.setActivityGate(enabled);
    if (enabled) {
      // Gate just turned on — re-check whether caffeinate should still be
      // active given current output activity.
      if (this.mode === "automatic" && this.supported) void this.pollAuto();
    } else {
      // Gate turned off — no need to re-snapshot; just recompute (which will
      // drop the output check from the condition).
      this.clearActivityGateTimer();
      this.recompute();
    }
    this.emit("change");
  }

  // Cheap, debounced nudge to re-check automatic detection in response to an
  // event (a session's foreground process changing, or a session
  // connecting/disconnecting). The debounce coalesces a burst of simultaneous
  // events into a single `ps` snapshot — it fires once and does not repeat.
  pokeAuto(): void {
    if (this.disposed || this.mode !== "automatic" || !this.supported) return;
    if (this.pokeTimer !== null) return;
    this.pokeTimer = setTimeout(() => {
      this.pokeTimer = null;
      void this.pollAuto();
    }, CAFFEINATE_AUTO_POKE_DEBOUNCE_MS);
    this.pokeTimer.unref?.();
  }

  // Record that output just arrived from a session. When the activity gate is
  // on, this resets the trailing-edge timer that checks whether caffeinate
  // should stay active. Output arriving while caffeinate is inactive is a
  // no-op (the foreground-change poke already handles the transition).
  noteOutputActivity(): void {
    if (this.disposed || this.mode !== "automatic" || !this.activityGate || !this.supported) {
      return;
    }
    if (!this.autoActive) {
      // Caffeinate is off but output just arrived — nudge a re-check
      // (the registry already recorded the fresh output timestamp).
      this.pokeAuto();
      return;
    }
    this.clearActivityGateTimer();
    // Schedule a re-check after the debounce window. If more output arrives
    // before this fires, the timer resets (trailing-edge).
    this.activityGateTimer = setTimeout(() => {
      this.activityGateTimer = null;
      void this.pollAuto();
    }, CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS);
    this.activityGateTimer.unref?.();
  }

  // Force an immediate automatic re-check and resolve when it settles. Used by
  // tests; production code re-checks via the event-driven debounced pokeAuto.
  pollNow(): Promise<void> {
    return this.pollAuto();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pokeTimer !== null) {
      clearTimeout(this.pokeTimer);
      this.pokeTimer = null;
    }
    this.clearActivityGateTimer();
    this.controller.dispose();
    this.removeAllListeners();
  }

  // The effective keep-awake triggers: fixed defaults plus the user's customs,
  // lowercased for case-insensitive matching.
  private triggerSet(): Set<string> {
    const triggers = new Set<string>();
    for (const command of this.defaultCommands) triggers.add(command.toLowerCase());
    for (const command of this.store.getCommands()) triggers.add(command.toLowerCase());
    return triggers;
  }

  private recompute(): void {
    const mode = this.mode;
    const desired = mode === "on" || (mode === "automatic" && this.autoActive);
    this.controller.setActive(desired);
  }

  private clearActivityGateTimer(): void {
    if (this.activityGateTimer !== null) {
      clearTimeout(this.activityGateTimer);
      this.activityGateTimer = null;
    }
  }

  private async pollAuto(): Promise<void> {
    if (this.disposed || this.mode !== "automatic" || !this.supported) return;
    // Serialize: if a snapshot is already running, run exactly one more after it
    // so the latest state always wins without piling up `ps` calls.
    if (this.polling) {
      this.pollQueued = true;
      return;
    }
    this.polling = true;
    try {
      const pids = this.listSessionPids();
      let next = false;
      let matchedTrigger: string | null = null;
      if (pids.length > 0) {
        const snapshot = await this.snapshotProcesses();
        matchedTrigger = anySessionRunsTrigger(pids, snapshot, this.triggerSet());
        if (matchedTrigger) {
          if (!this.activityGate) {
            next = true;
          } else if (this.checkRecentOutput) {
            next = this.checkRecentOutput(pids, CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS);
          }
        }
      }
      if (this.disposed || this.mode !== "automatic") return;
      const prevAutoActive = this.autoActive;
      this.autoActive = next;
      this.autoTrigger = next ? matchedTrigger : null;
      if (next !== prevAutoActive) {
        this.emit("change");
      }
      this.recompute();
      // If the activity gate is on and caffeinate is active, ensure the
      // trailing-edge idle timer is armed. (It may have been cleared by
      // noteOutputActivity or by a mode/command change.)
      if (this.activityGate && this.autoActive) {
        this.armActivityGateTimerIfNeeded();
      }
    } finally {
      this.polling = false;
      if (this.pollQueued && !this.disposed) {
        this.pollQueued = false;
        void this.pollAuto();
      }
    }
  }

  private armActivityGateTimerIfNeeded(): void {
    if (this.activityGateTimer !== null) return;
    this.activityGateTimer = setTimeout(() => {
      this.activityGateTimer = null;
      void this.pollAuto();
    }, CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS);
    this.activityGateTimer.unref?.();
  }
}
