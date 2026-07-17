import { EventEmitter } from "node:events";
import { CaffeinateAutomaticDetector } from "./caffeinate-automatic-detector.js";
import {
  defaultBatteryProbe,
  type BatteryProbe,
} from "./caffeinate-battery.js";
import { CaffeinateBatteryGuard } from "./caffeinate-battery-guard.js";
import type { CaffeinateController } from "./caffeinate-controller.js";
import type { CaffeinatePreferencesStore } from "./caffeinate-preferences-store.js";
import {
  defaultSnapshotProcesses,
  type SnapshotProcesses,
} from "./caffeinate-process-match.js";
import { CAFFEINATE_AUTO_DEFAULT_COMMANDS } from "./constants.js";
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
  // Whether any session currently has a second client attached (a peer: a
  // phone via the share QR, or another tab via the session picker). When peer
  // keep-awake is on, automatic mode also caffeinates while a peer is present,
  // held for the peer's lifetime and bypassing the activity gate so an
  // idle-but-attached phone must not release the machine to sleep.
  hasPeerClient?: () => boolean;
  // Live foreground program name reported per session by the shell's preexec
  // hook (OSC 7777 fg;<token>), keyed by the session shell's pid. When a
  // session's reported name is itself a keep-awake trigger, automatic mode
  // engages caffeinate WITHOUT a `ps` snapshot — the common case (the user
  // runs vim/ffmpeg/etc. directly). The process-tree walk still runs when no
  // hook name matches, so triggers that are children of the foreground command
  // (make -> ffmpeg) or running in an unhooked shell (sh/dash) keep working.
  foregroundNames?: () => Map<number, string>;
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
// program is running in a localterm session — discovered by matching each
// session's shell-hook foreground name (OSC 7777 fg;<token>) against the trigger
// set, falling back to a `ps` process-tree walk under the session's shell when
// no hook name matches. When the activity gate is enabled
// (the default), caffeinate further requires that a recognized program is
// producing output; after CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS of silence,
// caffeinate releases. When peer keep-awake is enabled (also the default),
// caffeinate ALSO stays active while any session has a second client attached
// (a phone joining via the share QR, or another tab via the session picker) —
// held for the peer's lifetime and bypassing the activity gate, since an
// idle-but-attached phone is exactly the state you want to hold the machine
// awake for. Emits `change` whenever any broadcastable field
// (mode/active/commands/batteryThreshold/peerKeepAwake) moves.
//
// Automatic detection is event-driven: it never polls on a timer. A `ps`
// snapshot is taken only when no session's hook foreground name matches a
// trigger, in response to an event — a session's foreground process changing,
// a session connecting/disconnecting, an output-activity change, or a
// mode/command change — via the debounced `pokeAuto`. (The foreground name
// comes from the shell's own preexec/precmd hooks — the same signal that
// powers the favicon — independently of keep-awake.)
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
  private readonly automaticDetector: CaffeinateAutomaticDetector;
  private readonly batteryGuard: CaffeinateBatteryGuard;
  readonly defaultCommands: readonly string[];
  private disposed = false;

  constructor(options: CaffeinateManagerOptions) {
    super();
    this.controller = options.controller;
    this.store = options.store;
    this.defaultCommands = options.defaultCommands ?? CAFFEINATE_AUTO_DEFAULT_COMMANDS;
    this.automaticDetector = new CaffeinateAutomaticDetector({
      listSessionPids: options.listSessionPids,
      snapshotProcesses: options.snapshotProcesses ?? defaultSnapshotProcesses,
      defaultCommands: this.defaultCommands,
      getCommands: () => this.store.getCommands(),
      getMode: () => this.mode,
      getActivityGate: () => this.activityGate,
      getPeerKeepAwake: () => this.peerKeepAwake,
      isSupported: () => this.supported,
      hasRecentOutput: options.hasRecentOutput,
      hasPeerClient: options.hasPeerClient ?? (() => false),
      foregroundNames: options.foregroundNames,
      emitChange: () => this.emit("change"),
      recompute: () => this.recompute(),
    });
    this.batteryGuard = new CaffeinateBatteryGuard({
      batteryProbe: options.batteryProbe ?? defaultBatteryProbe,
      getBatteryThreshold: () => this.batteryThreshold,
      isSupported: () => this.supported,
      wantsActive: () => this.modeWantsActive(),
      emitChange: () => this.emit("change"),
      recompute: () => this.recompute(),
    });

    // An unexpected death of the caffeinate process flips controller state; pass
    // that through so every tab rebroadcasts the authoritative `active`.
    this.controller.on("change", () => this.emit("change"));

    this.recompute();
    // One snapshot at startup in case a trigger is already running before any
    // event arrives; from here on detection is purely event-driven.
    if (this.mode === "automatic" && this.supported) void this.automaticDetector.poll();
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

  get peerKeepAwake(): boolean {
    return this.store.getPeerKeepAwake();
  }

  get batteryThreshold(): number | null {
    return this.store.getBatteryThreshold();
  }

  get activeTrigger(): string | null {
    return this.automaticDetector.activeTrigger;
  }

  get peerActive(): boolean {
    return this.automaticDetector.peerActive;
  }

  setMode(mode: CaffeinateMode): void {
    if (this.disposed) return;
    this.store.setMode(mode);
    this.automaticDetector.modeChanged(mode);
    this.recompute();
    if (mode === "automatic" && this.supported) void this.automaticDetector.poll();
    this.emit("change");
  }

  setCommands(commands: readonly string[]): void {
    if (this.disposed) return;
    this.store.setCommands(commands);
    // The trigger set changed; re-derive automatic detection immediately.
    if (this.mode === "automatic" && this.supported) void this.automaticDetector.poll();
    this.emit("change");
  }

  setActivityGate(enabled: boolean): void {
    if (this.disposed) return;
    this.store.setActivityGate(enabled);
    this.automaticDetector.activityGateChanged(enabled);
    this.emit("change");
  }

  setPeerKeepAwake(enabled: boolean): void {
    if (this.disposed) return;
    this.store.setPeerKeepAwake(enabled);
    // The trigger set changed; re-derive automatic detection immediately so a
    // peer that was already attached engages (or releases) at once.
    if (this.mode === "automatic" && this.supported) void this.automaticDetector.poll();
    this.emit("change");
  }

  pokeAuto(): void {
    this.automaticDetector.poke();
  }

  noteOutputActivity(): void {
    this.automaticDetector.noteOutputActivity();
  }

  pollNow(): Promise<void> {
    return this.automaticDetector.poll();
  }

  // Force an immediate battery re-check and resolve when it settles. Used by
  // tests; production code re-checks via the adaptive timer. Awaits an already
  // in-flight check (so concurrent test calls see the same resolved state)
  // rather than queueing a second probe.
  pollBatteryNow(): Promise<void> {
    return this.batteryGuard.pollNow();
  }

  // Set the persisted battery floor. `null` disables the guard. Persists
  // immediately (so every tab stays in lockstep via the broadcast) and re-derives
  // suppression from a fresh read so the user sees the floor take effect at
  // once rather than after the adaptive timer's first delay.
  setBatteryThreshold(percent: number | null): void {
    if (this.disposed) return;
    this.store.setBatteryThreshold(percent);
    this.emit("change");
    this.batteryGuard.thresholdChanged(percent);
  }

  dispose(): void {
    this.disposed = true;
    this.automaticDetector.dispose();
    this.batteryGuard.dispose();
    this.controller.dispose();
    this.removeAllListeners();
  }

  private recompute(): void {
    const wantActive = this.modeWantsActive();
    this.controller.setActive(this.batteryGuard.shouldActivate(wantActive));
  }

  private modeWantsActive(): boolean {
    const mode = this.mode;
    return mode === "on" || (mode === "automatic" && this.automaticDetector.active);
  }
}
