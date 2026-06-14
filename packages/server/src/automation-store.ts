import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUTOMATION_RUN_HISTORY_CAP, AUTOMATIONS_FILE_VERSION } from "./constants.js";
import {
  automationsFileSchema,
  automationsFileV1Schema,
  automationsFileV2Schema,
} from "./schemas.js";
import type {
  Automation,
  AutomationRunRecord,
  AutomationV1,
  AutomationV2,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "./types.js";
import { normalizeScheduleInput, normalizeTriggerInput } from "./utils/compile-schedule.js";

// A run is terminal once it has a definitive outcome; only those carry a
// finishedAt when migrated from a v1 lastRun.
const V1_TERMINAL_STATUSES = new Set(["completed", "failed", "missed"]);

// v1 stored a single `lastRun` and a raw cron string. Lift each into the v3
// shape: recognize the cron as a friendly preset where provably lossless (else
// keep it as {kind:"cron"}) and wrap it in a schedule trigger, seed runCount at
// 0 (so a migrated automation can never be spuriously "finished"), and fold
// lastRun into a one-entry history.
const migrateV1Automation = (v1: AutomationV1): Automation => {
  const runs: AutomationRunRecord[] = v1.lastRun
    ? [
        {
          runId: v1.lastRun.runId,
          scheduledFor: v1.lastRun.at,
          startedAt: v1.lastRun.at,
          finishedAt: V1_TERMINAL_STATUSES.has(v1.lastRun.status) ? v1.lastRun.at : null,
          status: v1.lastRun.status,
          exitCode: v1.lastRun.exitCode,
          trigger: "schedule",
          countsTowardLimit: v1.lastRun.status !== "missed",
        },
      ]
    : [];
  return {
    id: v1.id,
    name: v1.name,
    trigger: { kind: "schedule", schedule: normalizeScheduleInput(v1.schedule) },
    cwd: v1.cwd,
    command: v1.command,
    enabled: v1.enabled,
    limit: { kind: "forever" },
    closeOnFinish: false,
    runCount: 0,
    lifecycle: "active",
    runs,
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
  };
};

// v2 stored the trigger as a bare top-level `schedule`. v3 wraps it in a
// schedule trigger; everything else carries over unchanged.
const migrateV2Automation = (v2: AutomationV2): Automation => {
  const { schedule, ...rest } = v2;
  return { ...rest, trigger: { kind: "schedule", schedule } };
};

export class AutomationStore {
  private automations: Automation[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  list(): Automation[] {
    return [...this.automations];
  }

  get(id: string): Automation | null {
    return this.automations.find((automation) => automation.id === id) ?? null;
  }

  size(): number {
    return this.automations.length;
  }

  create(input: CreateAutomationInput): Automation {
    const now = Date.now();
    const automation: Automation = {
      id: randomUUID(),
      name: input.name,
      trigger: normalizeTriggerInput(input),
      cwd: input.cwd,
      command: input.command,
      enabled: input.enabled ?? true,
      limit: input.limit ?? { kind: "forever" },
      closeOnFinish: input.closeOnFinish ?? false,
      runCount: 0,
      lifecycle: "active",
      runs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.automations.push(automation);
    this.persist();
    return automation;
  }

  update(id: string, patch: UpdateAutomationInput): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const current = this.automations[index];
    const limit = patch.limit !== undefined ? patch.limit : current.limit;
    // "finished" is sticky: a PATCH never un-finishes (only reset does), but a
    // PATCH that lowers the limit below the current count finishes immediately.
    const lifecycle =
      limit.kind === "count" && current.runCount >= limit.max ? "finished" : current.lifecycle;
    const updated: Automation = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.trigger !== undefined || patch.schedule !== undefined
        ? { trigger: normalizeTriggerInput(patch) }
        : {}),
      ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
      ...(patch.command !== undefined ? { command: patch.command } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.closeOnFinish !== undefined ? { closeOnFinish: patch.closeOnFinish } : {}),
      limit,
      lifecycle,
      updatedAt: Date.now(),
    };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  remove(id: string): boolean {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return false;
    this.automations.splice(index, 1);
    this.persist();
    return true;
  }

  // Push a new run onto the newest-first history ring, trimming to the cap.
  appendRun(id: string, record: AutomationRunRecord): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const current = this.automations[index];
    const runs = [record, ...current.runs].slice(0, AUTOMATION_RUN_HISTORY_CAP);
    const updated: Automation = { ...current, runs };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  // Advance an existing run in place (launched -> running -> completed/failed/
  // missed). No-op (null) if the run has already aged out of the ring.
  updateRun(id: string, runId: string, patch: Partial<AutomationRunRecord>): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const current = this.automations[index];
    const runIndex = current.runs.findIndex((run) => run.runId === runId);
    if (runIndex === -1) return null;
    const runs = current.runs.map((run, position) =>
      position === runIndex ? { ...run, ...patch } : run,
    );
    const updated: Automation = { ...current, runs };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  // Count a launched run toward the limit, flipping to "finished" when the
  // budget is exhausted. Only scheduled launches call this.
  incrementRunCount(id: string): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const current = this.automations[index];
    const runCount = current.runCount + 1;
    const lifecycle =
      current.limit.kind === "count" && runCount >= current.limit.max
        ? "finished"
        : current.lifecycle;
    const updated: Automation = { ...current, runCount, lifecycle };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  // The only un-finish path: zero the count, reactivate, re-enable. History is
  // preserved unless explicitly cleared.
  reset(id: string, clearHistory = false): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const current = this.automations[index];
    const updated: Automation = {
      ...current,
      runCount: 0,
      lifecycle: "active",
      enabled: true,
      runs: clearHistory ? [] : current.runs,
      updatedAt: Date.now(),
    };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      console.warn(`automations file invalid; starting with an empty list (${this.filePath})`);
      return;
    }
    // Fast path: already v3.
    const v3 = automationsFileSchema.safeParse(json);
    if (v3.success) {
      this.automations = v3.data.automations;
      return;
    }
    // Migrate v2 -> v3 (wrap the bare schedule in a trigger), then persist so
    // later loads hit the fast path.
    const v2 = automationsFileV2Schema.safeParse(json);
    if (v2.success) {
      this.automations = v2.data.automations.map(migrateV2Automation);
      this.persist();
      return;
    }
    // Migrate v1 -> v3 once, then persist so later loads hit the fast path.
    const v1 = automationsFileV1Schema.safeParse(json);
    if (v1.success) {
      this.automations = v1.data.automations.map(migrateV1Automation);
      this.persist();
      return;
    }
    console.warn(`automations file invalid; starting with an empty list (${this.filePath})`);
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = { version: AUTOMATIONS_FILE_VERSION, automations: this.automations };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
