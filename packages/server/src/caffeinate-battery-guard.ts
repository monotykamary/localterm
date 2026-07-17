import {
  CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS,
  CAFFEINATE_BATTERY_POLL_MIN_INTERVAL_MS,
  CAFFEINATE_BATTERY_POLL_TIME_FRACTION,
  MS_PER_MINUTE,
} from "./constants.js";
import type { BatteryProbe, BatteryStatus } from "./caffeinate-battery.js";

interface CaffeinateBatteryGuardOptions {
  batteryProbe: BatteryProbe;
  getBatteryThreshold: () => number | null;
  isSupported: () => boolean;
  wantsActive: () => boolean;
  emitChange: () => void;
  recompute: () => void;
}

export class CaffeinateBatteryGuard {
  private readonly batteryProbe: BatteryProbe;
  private readonly getBatteryThreshold: () => number | null;
  private readonly isSupported: () => boolean;
  private readonly wantsActive: () => boolean;
  private readonly emitChange: () => void;
  private readonly recompute: () => void;
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
  private disposed = false;

  constructor(options: CaffeinateBatteryGuardOptions) {
    this.batteryProbe = options.batteryProbe;
    this.getBatteryThreshold = options.getBatteryThreshold;
    this.isSupported = options.isSupported;
    this.wantsActive = options.wantsActive;
    this.emitChange = options.emitChange;
    this.recompute = options.recompute;
  }

  shouldActivate(wantActive: boolean): boolean {
    const guardApplies = this.isSupported() && this.getBatteryThreshold() !== null;
    // While the guard is on but we've never read the battery, hold off engaging
    // until that first read resolves — otherwise a daemon that boots with the
    // battery already below the floor briefly spawns the power assertion before
    // the probe suppresses it. Subsequent arms use the cached flag instead.
    const needsFirstProbe = guardApplies && !this.hasProbedBattery;
    const desired = wantActive && !(guardApplies && (this.batteryLow || needsFirstProbe));
    if (wantActive && guardApplies) {
      // Start (or keep) the adaptive battery check armed. The next delay is
      // derived from the last status, or an immediate probe when there's no
      // cached reading yet.
      this.scheduleBatteryCheck(this.lastBatteryStatus);
    } else {
      this.clearBatteryTimer();
    }
    return desired;
  }

  // Force an immediate battery re-check and resolve when it settles. Used by
  // tests; production code re-checks via the adaptive timer. Awaits an already
  // in-flight check (so concurrent test calls see the same resolved state)
  // rather than queueing a second probe.
  pollNow(): Promise<void> {
    return this.runBatteryCheck();
  }

  // Set the persisted battery floor. `null` disables the guard. Persists
  // immediately (so every tab stays in lockstep via the broadcast) and re-derives
  // suppression from a fresh read so the user sees the floor take effect at
  // once rather than after the adaptive timer's first delay.
  thresholdChanged(percent: number | null): void {
    // Clear any pending adaptive check so the next read re-arms with a delay
    // derived from the new threshold (and a fresh status), not the old one.
    this.clearBatteryTimer();
    if (!this.isSupported() || percent === null) {
      // Guard disabled: clear any stale suppression so it can't keep
      // caffeinate off after the user turned the floor off.
      this.batteryLow = false;
      this.recompute();
      return;
    }
    if (this.wantsActive()) {
      // Probe immediately so an already-low battery stops caffeinate at once
      // (the adaptive arming would otherwise wait up to MAX_INTERVAL for the
      // first read, since lastBatteryStatus is stale/null until this resolves).
      void this.runBatteryCheck();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearBatteryTimer();
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
    const threshold = this.getBatteryThreshold();
    // Nothing to gate on: unsupported, guard disabled, or nothing wanting
    // active. The last case keeps the design claim that reads happen only while
    // a mode wants caffeinate active (a probe here would be wasted work and
    // couldn't change `desired`, since `wantActive` already forces it false).
    if (!this.isSupported() || threshold === null || !this.wantsActive()) {
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
      this.emitChange();
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
    const threshold = this.getBatteryThreshold();
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
}
