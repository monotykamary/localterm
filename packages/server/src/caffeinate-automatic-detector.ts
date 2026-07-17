import {
  anySessionRunsTrigger,
  commandMatchesTriggers,
  type SnapshotProcesses,
} from "./caffeinate-process-match.js";
import {
  CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS,
  CAFFEINATE_AUTO_POKE_DEBOUNCE_MS,
} from "./constants.js";
import type { CaffeinateMode } from "./types.js";

const EMPTY_FOREGROUND_NAMES: Map<number, string> = new Map();

interface CaffeinateAutomaticDetectorOptions {
  listSessionPids: () => number[];
  snapshotProcesses: SnapshotProcesses;
  defaultCommands: readonly string[];
  getCommands: () => string[];
  getMode: () => CaffeinateMode;
  getActivityGate: () => boolean;
  getPeerKeepAwake: () => boolean;
  isSupported: () => boolean;
  hasRecentOutput: ((pids: readonly number[], withinMs: number) => boolean) | undefined;
  hasPeerClient: () => boolean;
  foregroundNames: (() => Map<number, string>) | undefined;
  emitChange: () => void;
  recompute: () => void;
}

export class CaffeinateAutomaticDetector {
  private readonly listSessionPids: () => number[];
  private readonly snapshotProcesses: SnapshotProcesses;
  private readonly defaultCommands: readonly string[];
  private readonly getCommands: () => string[];
  private readonly getMode: () => CaffeinateMode;
  private readonly getActivityGate: () => boolean;
  private readonly getPeerKeepAwake: () => boolean;
  private readonly isSupported: () => boolean;
  private readonly checkRecentOutput:
    | ((pids: readonly number[], withinMs: number) => boolean)
    | undefined;
  private readonly hasPeerClient: () => boolean;
  private readonly foregroundNames: (() => Map<number, string>) | undefined;
  private readonly emitChange: () => void;
  private readonly recompute: () => void;
  private autoActive = false;
  private autoTrigger: string | null = null;
  // Whether the most recent poll held caffeinate because a peer was attached
  // (vs. a recognized program). Drives the activity-gate timer arming: a peer
  // holds until it disconnects (an event that pokes its own re-check), so the
  // silence-release timer must not arm while one is present.
  private autoPeerActive = false;
  private pokeTimer: NodeJS.Timeout | null = null;
  private activityGateTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private pollQueued = false;
  private disposed = false;

  constructor(options: CaffeinateAutomaticDetectorOptions) {
    this.listSessionPids = options.listSessionPids;
    this.snapshotProcesses = options.snapshotProcesses;
    this.defaultCommands = options.defaultCommands;
    this.getCommands = options.getCommands;
    this.getMode = options.getMode;
    this.getActivityGate = options.getActivityGate;
    this.getPeerKeepAwake = options.getPeerKeepAwake;
    this.isSupported = options.isSupported;
    this.checkRecentOutput = options.hasRecentOutput;
    this.hasPeerClient = options.hasPeerClient;
    this.foregroundNames = options.foregroundNames;
    this.emitChange = options.emitChange;
    this.recompute = options.recompute;
  }

  get active(): boolean {
    return this.autoActive;
  }

  get activeTrigger(): string | null {
    return this.autoActive ? this.autoTrigger : null;
  }

  // Whether automatic mode is currently holding caffeinate because a peer (a
  // second client on a session) is attached — independent of the program
  // trigger, so the UI can highlight the peer setting row even when a program
  // is also active (in which case `activeTrigger` carries the program name).
  get peerActive(): boolean {
    return this.autoPeerActive;
  }

  modeChanged(mode: CaffeinateMode): void {
    // Leaving automatic clears the cached detection so a later return to
    // automatic re-derives it from scratch rather than trusting a stale flag.
    if (mode !== "automatic") {
      this.autoActive = false;
      this.autoTrigger = null;
      this.autoPeerActive = false;
      this.clearActivityGateTimer();
    }
  }

  activityGateChanged(enabled: boolean): void {
    if (enabled) {
      // Gate just turned on — re-check whether caffeinate should still be
      // active given current output activity.
      if (this.getMode() === "automatic" && this.isSupported()) void this.poll();
    } else {
      // Gate turned off — no need to re-snapshot; just recompute (which will
      // drop the output check from the condition).
      this.clearActivityGateTimer();
      this.recompute();
    }
  }

  // Cheap, debounced nudge to re-check automatic detection in response to an
  // event (a session's foreground process changing, or a session
  // connecting/disconnecting). The debounce coalesces a burst of simultaneous
  // events into a single `ps` snapshot — it fires once and does not repeat.
  poke(): void {
    if (this.disposed || this.getMode() !== "automatic" || !this.isSupported()) return;
    if (this.pokeTimer !== null) return;
    this.pokeTimer = setTimeout(() => {
      this.pokeTimer = null;
      void this.poll();
    }, CAFFEINATE_AUTO_POKE_DEBOUNCE_MS);
    this.pokeTimer.unref?.();
  }

  // Record that output just arrived from a session. When the activity gate is
  // on, this resets the trailing-edge timer that checks whether caffeinate
  // should stay active. Output arriving while caffeinate is inactive is a
  // no-op (the foreground-change poke already handles the transition).
  noteOutputActivity(): void {
    if (
      this.disposed ||
      this.getMode() !== "automatic" ||
      !this.getActivityGate() ||
      !this.isSupported()
    ) {
      return;
    }
    if (!this.autoActive) {
      // Caffeinate is off but output just arrived — nudge a re-check
      // (the registry already recorded the fresh output timestamp).
      this.poke();
      return;
    }
    // A peer is holding caffeinate; output is irrelevant to it. The peer
    // releases on disconnect (an event that pokes its own re-check), so the
    // silence timer must not arm while one is present — otherwise the trailing
    // edge would poll on a timer and defeat the event-driven design.
    if (this.autoPeerActive) return;
    this.clearActivityGateTimer();
    // Schedule a re-check after the debounce window. If more output arrives
    // before this fires, the timer resets (trailing-edge).
    this.activityGateTimer = setTimeout(() => {
      this.activityGateTimer = null;
      void this.poll();
    }, CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS);
    this.activityGateTimer.unref?.();
  }

  // Force an immediate automatic re-check and resolve when it settles. Used by
  // tests; production code re-checks via the event-driven debounced pokeAuto.
  poll(): Promise<void> {
    return this.pollAuto();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pokeTimer !== null) {
      clearTimeout(this.pokeTimer);
      this.pokeTimer = null;
    }
    this.clearActivityGateTimer();
  }

  // The effective keep-awake triggers: fixed defaults plus the user's customs,
  // lowercased for case-insensitive matching.
  private triggerSet(): Set<string> {
    const triggers = new Set<string>();
    for (const command of this.defaultCommands) triggers.add(command.toLowerCase());
    for (const command of this.getCommands()) triggers.add(command.toLowerCase());
    return triggers;
  }

  // Whether any live session's shell-hook foreground name (OSC 7777 fg;<token>)
  // is itself a keep-awake trigger — the cheap, walk-free path used before
  // falling back to the `ps` process-tree snapshot. Returns the matching
  // trigger (lowercased) or null when no session's name matches.
  private hookTriggerFor(pids: readonly number[], triggers: ReadonlySet<string>): string | null {
    const names = this.foregroundNames?.() ?? EMPTY_FOREGROUND_NAMES;
    for (const pid of pids) {
      const name = names.get(pid);
      if (name) {
        const match = commandMatchesTriggers(name, triggers);
        if (match) return match;
      }
    }
    return null;
  }

  private async pollAuto(): Promise<void> {
    if (this.disposed || this.getMode() !== "automatic" || !this.isSupported()) return;
    // Serialize: if a snapshot is already running, run exactly one more after it
    // so the latest state always wins without piling up `ps` calls.
    if (this.polling) {
      this.pollQueued = true;
      return;
    }
    this.polling = true;
    try {
      const pids = this.listSessionPids();
      let programActive = false;
      let programTrigger: string | null = null;
      if (pids.length > 0) {
        const triggers = this.triggerSet();
        // Short-circuit: if any live session's hook-reported foreground name is
        // itself a trigger, engage without a `ps` snapshot (the common case —
        // the user runs vim/ffmpeg/etc. directly). Only fall back to the
        // process-tree walk when no hook name matches, which still catches
        // triggers that are children of the foreground command (make -> ffmpeg)
        // or running in an unhooked shell (sh/dash).
        programTrigger = this.hookTriggerFor(pids, triggers);
        if (programTrigger === null) {
          const snapshot = await this.snapshotProcesses();
          programTrigger = anySessionRunsTrigger(pids, snapshot, triggers);
        }
        if (programTrigger) {
          if (!this.getActivityGate()) {
            programActive = true;
          } else if (this.checkRecentOutput) {
            programActive = this.checkRecentOutput(pids, CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS);
          }
        }
      }
      if (this.disposed || this.getMode() !== "automatic") return;
      // A peer (a second client on a session) holds caffeinate independently of
      // the program detection and bypasses the activity gate: an idle-but-
      // attached phone must not release the machine to sleep. The peer's hold is
      // surfaced via `peerActive` (independent of `activeTrigger`, which carries
      // the program name) so the UI can highlight each setting row on its own
      // when both are active.
      const peerActive = this.getPeerKeepAwake() && this.hasPeerClient();
      const next = programActive || peerActive;
      const prevAutoActive = this.autoActive;
      const prevAutoTrigger = this.autoTrigger;
      const prevAutoPeerActive = this.autoPeerActive;
      this.autoActive = next;
      // `autoTrigger` carries only the program trigger (a command name or null);
      // the peer trigger is surfaced separately via `peerActive` so the UI can
      // highlight each setting row independently when both are active.
      this.autoTrigger = next ? programTrigger : null;
      this.autoPeerActive = peerActive;
      // Broadcast on any change to the broadcastable derived state, not just
      // when caffeinate turns on/off: the trigger identity (which program, or
      // whether a peer is holding) can flip while caffeinate stays continuously
      // active (a program starting while a peer is attached, a peer leaving
      // while a program runs). Without these the UI keeps a stale `activeTrigger`
      // / `peerActive` and the wrong row (or none) highlights.
      if (
        next !== prevAutoActive ||
        this.autoTrigger !== prevAutoTrigger ||
        this.autoPeerActive !== prevAutoPeerActive
      ) {
        this.emitChange();
      }
      this.recompute();
      if (peerActive) {
        // A peer now holds caffeinate; any program-silence timer armed before
        // the peer joined is obsolete (the peer releases on disconnect, not
        // on silence). Clear it so a stale trailing edge can't fire a spurious
        // poll and re-arm into a timer-driven loop.
        this.clearActivityGateTimer();
      }
      // Arm the silence-release timer only when a gated program is the SOLE
      // reason caffeinate is active. A peer holds until it disconnects (which
      // pokes its own re-check via onSessionActivity), so silence must not
      // release while one is present — and a program active alongside a peer is
      // also covered by the peer's hold.
      if (this.getActivityGate() && programActive && !peerActive) {
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

  private clearActivityGateTimer(): void {
    if (this.activityGateTimer !== null) {
      clearTimeout(this.activityGateTimer);
      this.activityGateTimer = null;
    }
  }
}
