import { EventEmitter } from "node:events";
import type { AutomationStore } from "./automation-store.js";
import {
  AUTOMATION_RECONCILE_MIN_DOWNTIME_MS,
  AUTOMATION_TICK_ALIGNMENT_DELAY_MS,
  MS_PER_MINUTE,
} from "./constants.js";
import type { Automation } from "./types.js";
import { computeNextAutomationRunAt } from "./utils/compute-next-automation-run-at.js";
import { enumerateMissedOccurrences } from "./utils/reconcile-downtime.js";

interface AutomationSchedulerEvents {
  due: [automation: Automation, scheduledFor: number];
  skipped: [automation: Automation, scheduledFor: number];
  tick: [now: Date, healthy: boolean];
  fault: [error: unknown];
}

export class AutomationScheduler extends EventEmitter<AutomationSchedulerEvents> {
  private tickTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private lastTickAt: number | null = null;

  constructor(private readonly store: AutomationStore) {
    super();
  }

  start(lastAliveAt: number | null = null): void {
    if (this.disposed || this.tickTimer !== null) return;
    this.lastTickAt = lastAliveAt;
    this.runTick();
    this.scheduleNextTick();
  }

  refresh(): void {
    if (this.disposed) return;
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.scheduleNextTick();
  }

  dispose(): void {
    this.disposed = true;
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.removeAllListeners();
  }

  runTick(now: Date = new Date()): void {
    if (this.disposed) return;
    const at = now.getTime();
    const since = this.lastTickAt ?? Math.floor(at / MS_PER_MINUTE) * MS_PER_MINUTE - 1;
    const gap = this.lastTickAt !== null && at - since >= AUTOMATION_RECONCILE_MIN_DOWNTIME_MS;
    let healthy = true;
    for (const automation of this.store.list()) {
      if (
        !automation.enabled ||
        automation.lifecycle === "finished" ||
        automation.trigger.kind !== "schedule"
      )
        continue;
      try {
        const from = Math.max(since, automation.createdAt, automation.lastScheduledAt ?? -1);
        const occurrences = enumerateMissedOccurrences(automation, from, at + 1);
        const latest = occurrences.at(-1);
        for (const scheduledFor of occurrences) {
          const shouldRun =
            scheduledFor === latest &&
            (!gap ||
              automation.missedRunPolicy === "run-latest" ||
              at - scheduledFor < MS_PER_MINUTE);
          this.emit(shouldRun ? "due" : "skipped", automation, scheduledFor);
        }
      } catch (error) {
        healthy = false;
        this.emit("fault", error);
      }
    }
    // If persistence failed, retry the window; the durable occurrence watermark
    // deduplicates automations whose decisions already committed.
    if (healthy) this.lastTickAt = at;
    this.emit("tick", now, healthy);
  }

  private scheduleNextTick(): void {
    if (this.disposed) return;
    const now = Date.now();
    let nextAt = now + MS_PER_MINUTE - (now % MS_PER_MINUTE);
    for (const automation of this.store.list()) {
      const next = computeNextAutomationRunAt(automation, new Date(now));
      if (next !== null) nextAt = Math.min(nextAt, next);
    }
    this.tickTimer = setTimeout(
      () => {
        this.tickTimer = null;
        try {
          this.runTick();
        } finally {
          this.scheduleNextTick();
        }
      },
      Math.max(
        AUTOMATION_TICK_ALIGNMENT_DELAY_MS,
        nextAt - now + AUTOMATION_TICK_ALIGNMENT_DELAY_MS,
      ),
    );
    this.tickTimer.unref?.();
  }
}
