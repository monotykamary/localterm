import { randomUUID } from "node:crypto";
import type { AutomationStore } from "./automation-store.js";
import { MAX_AUTOMATION_CONCURRENT_RUNS } from "./constants.js";
import type { Automation, AutomationRunRecord } from "./types.js";
import { isActiveAutomationRun } from "./utils/is-active-automation-run.js";
import { trimAutomationRuns } from "./utils/trim-automation-runs.js";

interface AutomationDispatcherOptions {
  store: AutomationStore;
  launch: (automation: Automation, run: AutomationRunRecord) => void | Promise<void>;
  changed: () => void;
  now?: () => number;
}

export class AutomationDispatcher {
  private readonly exclusive = new Set<string>();
  private disposed = false;

  constructor(private readonly options: AutomationDispatcherOptions) {}

  request(
    id: string,
    trigger: AutomationRunRecord["trigger"],
    scheduledFor = this.now(),
    skippedReason?: AutomationRunRecord["reason"],
  ): string | null {
    if (this.disposed) return null;
    const automation = this.options.store.get(id);
    if (!automation) return null;
    if (trigger !== "manual" && (!automation.enabled || automation.lifecycle === "finished"))
      return null;
    if (trigger === "schedule" && scheduledFor <= (automation.lastScheduledAt ?? -1)) {
      return (
        automation.runs.find((run) => run.trigger === trigger && run.scheduledFor === scheduledFor)
          ?.runId ?? null
      );
    }
    const active = automation.runs.filter(isActiveAutomationRun);
    const thread = automation.runner.kind === "agent" && automation.runner.sessionMode === "thread";
    const policy =
      thread && automation.concurrencyPolicy === "allow"
        ? "queue-latest"
        : (automation.concurrencyPolicy ?? "skip");
    const busy = active.length > 0 || this.exclusive.has(id);
    const reason =
      skippedReason ??
      (busy && policy === "skip"
        ? "overlap"
        : policy === "allow" && active.length >= MAX_AUTOMATION_CONCURRENT_RUNS
          ? "capacity"
          : undefined);
    const now = this.now();
    const run: AutomationRunRecord = {
      runId: randomUUID(),
      scheduledFor,
      startedAt: null,
      finishedAt: reason ? now : null,
      status: reason ? "skipped" : "queued",
      reason,
      exitCode: null,
      trigger,
      countsTowardLimit: false,
      findings: null,
      changedFiles: [],
      unread: false,
      log: null,
      execution: {
        cwd: automation.cwd,
        runner: structuredClone(automation.runner),
        requestedSecrets: [...automation.requestedSecrets],
        redactOutput: automation.redactOutput ?? false,
        closeOnFinish: automation.closeOnFinish,
      },
    };
    this.options.store.transact(id, (current) => ({
      ...current,
      ...(trigger === "schedule" ? { lastScheduledAt: scheduledFor } : {}),
      runs: trimAutomationRuns([
        run,
        ...current.runs.map(
          (previous): AutomationRunRecord =>
            !reason && policy === "queue-latest" && previous.status === "queued"
              ? { ...previous, status: "skipped", reason: "superseded", finishedAt: now }
              : previous,
        ),
      ]),
    }));
    this.options.changed();
    if (!reason) this.drain(id);
    return run.runId;
  }

  // Only accepted but unstarted work is replayable. Once launch was committed,
  // external side effects may have happened; never rerun an interrupted command.
  recover(): void {
    const now = this.now();
    for (const automation of this.options.store.list()) {
      if (!automation.runs.some((run) => run.status === "running" || run.status === "launched"))
        continue;
      this.options.store.transact(automation.id, (current) => ({
        ...current,
        runs: current.runs.map((run) =>
          run.status === "running" || run.status === "launched"
            ? { ...run, status: "interrupted", reason: "restart", finishedAt: now }
            : run,
        ),
      }));
    }
    this.options.changed();
    for (const automation of this.options.store.list()) this.drain(automation.id);
  }

  drain(id: string): void {
    if (this.disposed || this.exclusive.has(id)) return;
    let automation = this.options.store.get(id);
    if (!automation) return;
    for (const pending of [...automation.runs].reverse()) {
      if (pending.status !== "queued") continue;
      automation = this.options.store.get(id);
      if (!automation) return;
      const run = automation.runs.find((entry) => entry.runId === pending.runId);
      if (!run || run.status !== "queued") continue;
      if (
        run.trigger !== "manual" &&
        (!automation.enabled || automation.lifecycle === "finished")
      ) {
        this.finish(id, run.runId, "cancelled", automation.enabled ? "limit" : "disabled");
        continue;
      }
      const active = automation.runs.filter(
        (entry) => entry.status === "running" || entry.status === "launched",
      );
      const currentRunner = automation.runner;
      const runner = run.execution?.runner ?? currentRunner;
      const sharedThread =
        (runner.kind === "agent" && runner.sessionMode === "thread") ||
        active.some((entry) => {
          const activeRunner = entry.execution?.runner ?? currentRunner;
          return activeRunner.kind === "agent" && activeRunner.sessionMode === "thread";
        });
      if (
        active.length >= MAX_AUTOMATION_CONCURRENT_RUNS ||
        (active.length > 0 && (sharedThread || automation.concurrencyPolicy !== "allow"))
      )
        continue;
      const now = this.now();
      const counts = run.trigger !== "manual";
      const status = runner.kind === "agent" ? "running" : "launched";
      const updated = this.options.store.transact(id, (current) => {
        const runCount = current.runCount + (counts ? 1 : 0);
        return {
          ...current,
          runCount,
          lifecycle:
            current.limit.kind === "count" && runCount >= current.limit.max
              ? "finished"
              : current.lifecycle,
          runs: current.runs.map((entry) =>
            entry.runId === run.runId
              ? { ...entry, status, startedAt: now, countsTowardLimit: counts }
              : entry,
          ),
        };
      });
      if (!updated) return;
      const started = updated.runs.find((entry) => entry.runId === run.runId);
      if (!started) continue;
      this.options.changed();
      try {
        const result = this.options.launch({ ...updated, ...started.execution }, started);
        void Promise.resolve(result).catch(() => this.launchFailed(id, run.runId));
      } catch {
        this.launchFailed(id, run.runId);
      }
    }
  }

  cancel(id: string, runId: string): boolean {
    const run = this.options.store.get(id)?.runs.find((entry) => entry.runId === runId);
    if (run?.status !== "queued") return false;
    this.finish(id, runId, "cancelled", "cancelled");
    return true;
  }

  isBusy(id: string): boolean {
    return (
      this.exclusive.has(id) ||
      (this.options.store.get(id)?.runs.some(isActiveAutomationRun) ?? false)
    );
  }

  acquireExclusive(id: string): boolean {
    if (this.isBusy(id)) return false;
    this.exclusive.add(id);
    return true;
  }

  releaseExclusive(id: string): void {
    this.exclusive.delete(id);
    this.drain(id);
  }

  dispose(): void {
    this.disposed = true;
  }

  private finish(
    id: string,
    runId: string,
    status: AutomationRunRecord["status"],
    reason: AutomationRunRecord["reason"],
  ): void {
    this.options.store.updateRun(id, runId, { status, reason, finishedAt: this.now() });
    this.options.changed();
  }

  private launchFailed(id: string, runId: string): void {
    if (this.disposed) return;
    const run = this.options.store.get(id)?.runs.find((entry) => entry.runId === runId);
    if (!run || !isActiveAutomationRun(run)) return;
    this.finish(id, runId, "failed", "launch-failed");
    this.drain(id);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
