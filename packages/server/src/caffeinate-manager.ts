import { EventEmitter } from "node:events";
import type { CaffeinateController } from "./caffeinate-controller.js";
import type { CaffeinatePreferencesStore } from "./caffeinate-preferences-store.js";
import {
  anySessionRunsTrigger,
  defaultSnapshotProcesses,
  type SnapshotProcesses,
} from "./caffeinate-process-match.js";
import { CAFFEINATE_AUTO_DEFAULT_COMMANDS, CAFFEINATE_AUTO_POKE_DEBOUNCE_MS } from "./constants.js";
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
}

interface CaffeinateManagerEvents {
  change: [];
}

// Decides *when* the daemon's single keep-awake process runs, on top of the
// dumb CaffeinateController (which only knows start/stop). In "on" it is always
// active, in "off" never, and in "automatic" it tracks whether any recognized
// program is running in a localterm session — discovered by walking the `ps`
// process tree under each session's shell. Emits `change` whenever any
// broadcastable field (mode/active/commands) moves.
//
// Automatic detection is event-driven: it never polls on a timer. A `ps`
// snapshot is taken only in response to an event — a session's foreground
// process changing, a session connecting/disconnecting, or a mode/command
// change — via the debounced `pokeAuto`. (The foreground signal itself rides
// on node-pty's existing per-session foreground tracking, which powers the
// favicon and exists independently of keep-awake.)
export class CaffeinateManager extends EventEmitter<CaffeinateManagerEvents> {
  private readonly controller: CaffeinateController;
  private readonly store: CaffeinatePreferencesStore;
  private readonly listSessionPids: () => number[];
  private readonly snapshotProcesses: SnapshotProcesses;
  readonly defaultCommands: readonly string[];

  private autoActive = false;
  private pokeTimer: NodeJS.Timeout | null = null;
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

  setMode(mode: CaffeinateMode): void {
    if (this.disposed) return;
    this.store.setMode(mode);
    // Leaving automatic clears the cached detection so a later return to
    // automatic re-derives it from scratch rather than trusting a stale flag.
    if (mode !== "automatic") this.autoActive = false;
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
      if (pids.length > 0) {
        const snapshot = await this.snapshotProcesses();
        next = anySessionRunsTrigger(pids, snapshot, this.triggerSet());
      }
      if (this.disposed || this.mode !== "automatic") return;
      if (next !== this.autoActive) {
        this.autoActive = next;
        this.recompute();
        // controller emits `change` only when `active` actually flips; if the
        // process state didn't change but detection did, no broadcast is needed
        // since `active` is unchanged.
      }
    } finally {
      this.polling = false;
      if (this.pollQueued && !this.disposed) {
        this.pollQueued = false;
        void this.pollAuto();
      }
    }
  }
}
