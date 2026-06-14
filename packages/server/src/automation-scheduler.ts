import { EventEmitter } from "node:events";
import type { AutomationStore } from "./automation-store.js";
import { AUTOMATION_TICK_ALIGNMENT_DELAY_MS, MS_PER_MINUTE } from "./constants.js";
import { cronMatchesDate, parseCronExpression } from "./cron-expression.js";
import type { Automation } from "./types.js";
import { compileScheduleAll } from "./utils/compile-schedule.js";

interface AutomationSchedulerEvents {
  due: [automation: Automation];
  tick: [now: Date];
}

export class AutomationScheduler extends EventEmitter<AutomationSchedulerEvents> {
  private tickTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private readonly lastFiredMinuteByAutomationId = new Map<string, number>();

  constructor(private readonly store: AutomationStore) {
    super();
  }

  start(): void {
    if (this.disposed || this.tickTimer !== null) return;
    this.scheduleNextTick();
  }

  dispose(): void {
    this.disposed = true;
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.removeAllListeners();
  }

  runTick(now: Date = new Date()): void {
    if (this.disposed) return;
    const minuteKey = Math.floor(now.getTime() / MS_PER_MINUTE);
    const automations = this.store.list();
    for (const automation of automations) {
      if (!automation.enabled) continue;
      if (automation.lifecycle === "finished") continue;
      // Watch triggers are event-driven (FolderWatchManager owns them); the
      // minute ticker only fires time-based schedules.
      if (automation.trigger.kind !== "schedule") continue;
      const matched = compileScheduleAll(automation.trigger.schedule).some((expression) => {
        const parsed = parseCronExpression(expression);
        return parsed !== null && cronMatchesDate(parsed, now);
      });
      if (!matched) continue;
      if (this.lastFiredMinuteByAutomationId.get(automation.id) === minuteKey) continue;
      this.lastFiredMinuteByAutomationId.set(automation.id, minuteKey);
      this.emit("due", automation);
    }
    const liveIds = new Set(automations.map((automation) => automation.id));
    for (const trackedId of [...this.lastFiredMinuteByAutomationId.keys()]) {
      if (!liveIds.has(trackedId)) this.lastFiredMinuteByAutomationId.delete(trackedId);
    }
    this.emit("tick", now);
  }

  private scheduleNextTick(): void {
    if (this.disposed) return;
    const now = Date.now();
    const delayMs = MS_PER_MINUTE - (now % MS_PER_MINUTE) + AUTOMATION_TICK_ALIGNMENT_DELAY_MS;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.runTick();
      this.scheduleNextTick();
    }, delayMs);
    this.tickTimer.unref?.();
  }
}
