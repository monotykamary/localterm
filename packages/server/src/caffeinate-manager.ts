import { EventEmitter } from "node:events";
import type { CaffeinateController } from "./caffeinate-controller.js";
import type { CaffeinatePreferencesStore } from "./caffeinate-preferences-store.js";
import {
  defaultBatteryProbe,
  type BatteryProbe,
  type BatteryStatus,
} from "./caffeinate-battery.js";
import {
  anySessionRunsTrigger,
  defaultSnapshotProcesses,
  type SnapshotProcesses,
} from "./caffeinate-process-match.js";
import {
  CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS,
  CAFFEINATE_AUTO_DEFAULT_COMMANDS,
  CAFFEINATE_AUTO_POKE_DEBOUNCE_MS,
  CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS,
  CAFFEINATE_BATTERY_POLL_MIN_INTERVAL_MS,
  CAFFEINATE_BATTERY_POLL_TIME_FRACTION,
  MS_PER_MINUTE,
} from "./constants.js";
import type { CaffeinateMode } from "./types.js";

export interface CaffeinateManagerOptions {
  controller: CaffeinateController;
  store: CaffeinatePreferencesStore;
  // Live shell pids of every session (usually SessionManager.pids). Automatic
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
  // Injectable battery probe for tests; defaults to a real `pmset` read on
  // macOS and a sysfs read on Linux. The battery floor is enforced on an
  // adaptive schedule that mirrors the activity gate's design: status-driven (a
  // probe only happens while a mode wants caffeinate active, and the next read's
  // delay is derived from the latest estimate).
  batteryProbe?: BatteryProbe;
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
// (mode/active/commands/batteryThreshold) moves.
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
//
// The battery floor is the one piece of polling in this module, and it is
// adaptive rather than a fixed heartbeat: a battery read happens only while a
// mode wants caffeinate active (off/idle `automatic` never reads it), and the
// delay until the next read is 1/TIME_FRACTION of the interpolated
// time-to-threshold, so polling tightens as the floor approaches and stays lax
// far from it (capped at MAX, floored at MIN). The OS pushes no notification at
// an arbitrary percent, so a bounded polling timer is unavoidable here; the
// adaptive schedule keeps it as cheap as it can be. While below the floor on
// battery, the daemon refuses to hold the power assertion (it stops caffeinate
// without changing the selected mode); plugging in or charging back above the
// floor resumes normally.
export class CaffeinateManager extends EventEmitter<CaffeinateManagerEvents> {
  private readonly controller: CaffeinateController;
  private readonly store: CaffeinatePreferencesStore;
  private readonly listSessionPids: () => number[];
  private readonly snapshotProcesses: SnapshotProcesses;
  private readonly checkRecentOutput?: (pids: readonly number[], withinMs: number) => boolean;
  private readonly batteryProbe: BatteryProbe;
  readonly defaultCommands: readonly string[];

  private autoActive = false;
  private autoTrigger: string | null = null;
  private pokeTimer: NodeJS.Timeout | null = null;
  private activityGateTimer: NodeJS.Timeout | null = null;
  // The cached battery-suppression flag: true means the machine is on battery
  // power at or below the configured threshold, so `recompute` suppresses
  // caffeinate regardless of what the mode wants.
  private batteryLow = false;
  // The most recent battery read, used to choose the next adaptive delay. Null
  // until the first read completes (and is reset to null after a read failure
  // so computeBatteryDelay's null branch picks MAX — fail-open retries slowly).
  private lastBatteryStatus: BatteryStatus | null = null;
  // Whether performBatteryCheck has resolved at least once. Drives
  // `needsFirstProbe` in `recompute` independently of lastBatteryStatus: a
  // daemon that boots with the battery already below the floor never briefly
  // spawns the power assertion before the first read suppresses it, while a
  // later failed read (lastBatteryStatus -> null) still fail-opens instead of
  // re-gating caffeinate off forever.
  private hasProbedBattery = false;
  private batteryTimer: NodeJS.Timeout | null = null;
  // Coalesces concurrent battery checks: callers (the timer, setBatteryThreshold,
  // pollBatteryNow) all funnel through runBatteryCheck, which returns the same
  // in-flight promise so they all settle on the same result without piling up
  // battery reads — the promise-tracking analogue of pollAuto's polling flag.
  private batteryCheckInFlight: Promise<void> | null = null;
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
    this.batteryProbe = options.batteryProbe ?? defaultBatteryProbe;

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

  get batteryThreshold(): number | null {
    return this.store.getBatteryThreshold();
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
    this.clearBatteryTimer();
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
    const wantActive = this.modeWantsActive();
    const guardApplies = this.supported && this.batteryThreshold !== null;
    // While the guard is on but we've never read the battery, hold off engaging
    // until that first read resolves — otherwise a daemon that boots with the
    // battery already below the floor briefly spawns the power assertion before
    // the probe suppresses it. Subsequent arms use the cached flag instead.
    const needsFirstProbe = guardApplies && !this.hasProbedBattery;
    const desired = wantActive && !(guardApplies && (this.batteryLow || needsFirstProbe));
    this.controller.setActive(desired);
    if (wantActive && guardApplies) {
      // Start (or keep) the adaptive battery check armed. The next delay is
      // derived from the last status, or an immediate probe when there's no
      // cached reading yet.
      this.scheduleBatteryCheck(this.lastBatteryStatus);
    } else {
      this.clearBatteryTimer();
    }
  }

  private modeWantsActive(): boolean {
    const mode = this.mode;
    return mode === "on" || (mode === "automatic" && this.autoActive);
  }

  private clearActivityGateTimer(): void {
    if (this.activityGateTimer !== null) {
      clearTimeout(this.activityGateTimer);
      this.activityGateTimer = null;
    }
  }

  // Force an immediate battery re-check and resolve when it settles. Used by
  // tests; production code re-checks via the adaptive timer. Awaits an already
  // in-flight check (so concurrent test calls see the same resolved state)
  // rather than queueing a second probe.
  pollBatteryNow(): Promise<void> {
    return this.runBatteryCheck();
  }

  // Set the persisted battery floor. `null` disables the guard. Persists
  // immediately (so every tab stays in lockstep via the broadcast) and re-derives
  // suppression from a fresh read so the user sees the floor take effect at
  // once rather than after the adaptive timer's first delay.
  setBatteryThreshold(percent: number | null): void {
    if (this.disposed) return;
    this.store.setBatteryThreshold(percent);
    this.emit("change");
    // Clear any pending adaptive check so the next read re-arms with a delay
    // derived from the new threshold (and a fresh status), not the old one.
    this.clearBatteryTimer();
    if (!this.supported || percent === null) {
      // Guard disabled: clear any stale suppression so it can't keep
      // caffeinate off after the user turned the floor off.
      this.batteryLow = false;
      this.recompute();
      return;
    }
    if (this.modeWantsActive()) {
      // Probe immediately so an already-low battery stops caffeinate at once
      // (the adaptive arming would otherwise wait up to MAX_INTERVAL for the
      // first read, since lastBatteryStatus is stale/null until this resolves).
      void this.runBatteryCheck();
    }
  }

  // Single entry point for every battery probe. Coalesces concurrent callers
  // onto one in-flight promise so the `pmset` call fires at most once per tick
  // even if the timer, setBatteryThreshold, and a manual pollBatteryNow all race.
  private runBatteryCheck(): Promise<void> {
    if (this.batteryCheckInFlight !== null) return this.batteryCheckInFlight;
    const promise = this.performBatteryCheck().finally(() => {
      if (this.batteryCheckInFlight === promise) this.batteryCheckInFlight = null;
    });
    this.batteryCheckInFlight = promise;
    return promise;
  }

  private async performBatteryCheck(): Promise<void> {
    if (this.disposed) return;
    const threshold = this.batteryThreshold;
    // Nothing to gate on: unsupported, guard disabled, or nothing wanting
    // active. The last case keeps the design claim that reads happen only while
    // a mode wants caffeinate active (a probe here would be wasted work and
    // couldn't change `desired`, since `wantActive` already forces it false).
    if (!this.supported || threshold === null || !this.modeWantsActive()) {
      this.clearBatteryTimer();
      return;
    }
    const status = await this.batteryProbe();
    if (this.disposed) return;
    this.lastBatteryStatus = status;
    this.hasProbedBattery = true;
    // Fail-open on read failure (null): a missing battery or a transient pmset
    // error cannot take keep-awake away from the user. The scheduler stays
    // armed via the recompute below so a later successful read can re-impose
    // the floor.
    const nextLow = status !== null && status.isOnBattery && status.percent <= threshold;
    if (nextLow !== this.batteryLow) {
      this.batteryLow = nextLow;
      this.emit("change");
    }
    this.recompute();
  }

  private scheduleBatteryCheck(status: BatteryStatus | null): void {
    if (this.disposed) return;
    // Coalesce: if a check is already armed, let it run — it reschedules
    // adaptively from a fresh read when it completes, so re-entry here is a no-op.
    if (this.batteryTimer !== null) return;
    if (!this.hasProbedBattery) {
      // Never probed: fire immediately (coalesced by runBatteryCheck) so the
      // first arm doesn't wait MAX before applying the floor — a daemon that
      // boots with the battery already below the threshold suppresses at once.
      void this.runBatteryCheck();
      return;
    }
    // A null status here means a prior probe failed or found no battery:
    // computeBatteryDelay maps that to MAX so we retry slowly instead of
    // re-firing immediately and busy-looping on a persistently-failing read.
    const delay = this.computeBatteryDelay(status);
    this.batteryTimer = setTimeout(() => {
      this.batteryTimer = null;
      void this.runBatteryCheck();
    }, delay);
    this.batteryTimer.unref?.();
  }

  private computeBatteryDelay(status: BatteryStatus | null): number {
    const threshold = this.batteryThreshold;
    if (threshold === null) return CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS;
    // Already suppressed: poll fast so charging back above the threshold or
    // plugging in resumes promptly. Bounded by how long the machine stays
    // below the floor — which should be short (it's about to lose power).
    if (this.batteryLow) return CAFFEINATE_BATTERY_POLL_MIN_INTERVAL_MS;
    if (status === null || !status.isOnBattery) return CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS;
    if (status.minutesToEmpty === null) return CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS;
    // Half of the interpolated time-to-threshold: the OS estimate (minutes to
    // 0%) scaled by the charge fraction still above the floor. Halving gives a
    // 2× buffer against the EWMA lagging real discharge (and the active program
    // draining faster than the idle minutes the average was computed over), so
    // a stale-high estimate still catches the crossing in time rather than
    // sleeping past it. Clamped to [MIN, MAX] below.
    const remaining = status.percent - threshold;
    if (remaining <= 0) return CAFFEINATE_BATTERY_POLL_MIN_INTERVAL_MS;
    const fractionAbove = remaining / status.percent;
    const interpolatedMs = status.minutesToEmpty * MS_PER_MINUTE * fractionAbove;
    const scheduledMs = interpolatedMs / CAFFEINATE_BATTERY_POLL_TIME_FRACTION;
    return Math.max(
      CAFFEINATE_BATTERY_POLL_MIN_INTERVAL_MS,
      Math.min(scheduledMs, CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS),
    );
  }

  private clearBatteryTimer(): void {
    if (this.batteryTimer !== null) {
      clearTimeout(this.batteryTimer);
      this.batteryTimer = null;
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
