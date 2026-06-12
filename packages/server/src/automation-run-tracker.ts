import { randomUUID } from "node:crypto";
import { AUTOMATION_PENDING_RUN_EXPIRY_MS } from "./constants.js";
import type { Automation, PendingAutomationRun } from "./types.js";

export class AutomationRunTracker {
  private readonly pendingRuns = new Map<string, PendingAutomationRun>();

  create(automation: Automation, now: number = Date.now()): PendingAutomationRun {
    const run: PendingAutomationRun = {
      runId: randomUUID(),
      automationId: automation.id,
      cwd: automation.cwd,
      command: automation.command,
      createdAt: now,
    };
    this.pendingRuns.set(run.runId, run);
    return run;
  }

  claim(runId: string): PendingAutomationRun | null {
    const run = this.pendingRuns.get(runId);
    if (!run) return null;
    this.pendingRuns.delete(runId);
    return run;
  }

  sweepExpired(now: number = Date.now()): PendingAutomationRun[] {
    const expired: PendingAutomationRun[] = [];
    for (const run of this.pendingRuns.values()) {
      if (now - run.createdAt >= AUTOMATION_PENDING_RUN_EXPIRY_MS) expired.push(run);
    }
    for (const run of expired) {
      this.pendingRuns.delete(run.runId);
    }
    return expired;
  }

  size(): number {
    return this.pendingRuns.size;
  }
}
