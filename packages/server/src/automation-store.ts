import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AUTOMATION_RUN_HISTORY_CAP,
  AUTOMATIONS_FILE_VERSION,
  MAX_AUTOMATION_FINDINGS_LENGTH,
  MAX_AUTOMATION_LOG_LENGTH,
  MAX_AUTOMATION_TOOL_RESULT_LENGTH,
} from "./constants.js";
import {
  automationsFileSchema,
  automationsFileV1Schema,
  automationsFileV2Schema,
  automationsFileV3Schema,
} from "./schemas.js";
import type {
  Automation,
  AutomationRunRecord,
  AutomationTrigger,
  AutomationV1,
  AutomationV2,
  AutomationV3,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "./types.js";
import { normalizeScheduleInput } from "./utils/compile-schedule.js";
import { generateWebhookId } from "./utils/generate-webhook-id.js";
import { normalizeTriggerInput } from "./utils/normalize-trigger.js";

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
          findings: null,
          changedFiles: [],
          unread: false,
          log: null,
        },
      ]
    : [];
  return {
    id: v1.id,
    name: v1.name,
    trigger: { kind: "schedule", schedule: normalizeScheduleInput(v1.schedule) },
    cwd: v1.cwd,
    runner: { kind: "shell", command: v1.command },
    enabled: v1.enabled,
    limit: { kind: "forever" },
    closeOnFinish: false,
    requestedSecrets: [],
    runCount: 0,
    lifecycle: "active",
    runs,
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
  };
};

// v2 stored the trigger as a bare top-level `schedule` and the runner as a
// bare top-level `command` (shell-only). v4 wraps both: the schedule in a
// trigger and the command in a shell runner.
const migrateV2Automation = (v2: AutomationV2): Automation => {
  const { schedule, command, ...rest } = v2;
  return {
    ...rest,
    trigger: { kind: "schedule", schedule },
    runner: { kind: "shell", command },
    requestedSecrets: [],
  };
};

// v3 stored the runner as a bare top-level `command` (shell-only). v4 wraps it
// in a discriminated `runner` union; a v3 automation is always a shell runner.
// The v4 run-record schema's defaulted findings/changedFiles/unread fill in
// for v3 runs that lack them, so `runs` carries over unchanged.
const migrateV3Automation = (v3: AutomationV3): Automation => {
  const { command, ...rest } = v3;
  return { ...rest, runner: { kind: "shell", command } };
};

// Repair in place any stored state the current v4 schema no longer accepts:
// run-log/findings text above the per-field cap (an older build truncated to
// `cap` + marker, over `.max(cap)`), and the removed `autoCompact` runner
// flag (the harness now handles compaction by default). Stripping these lets
// an older file load instead of stranding every automation behind a strict
// schema rejection. Returns whether anything changed.
const repairAutomationsJson = (json: unknown): boolean => {
  if (!json || typeof json !== "object") return false;
  const root = json as { automations?: unknown[] };
  if (!Array.isArray(root.automations)) return false;
  let changed = false;
  for (const automation of root.automations) {
    if (!automation || typeof automation !== "object") continue;
    const record = automation as { runs?: unknown[]; findings?: unknown; runner?: unknown };
    if (
      record.runner &&
      typeof record.runner === "object" &&
      "autoCompact" in (record.runner as Record<string, unknown>)
    ) {
      delete (record.runner as Record<string, unknown>).autoCompact;
      changed = true;
    }
    if (
      typeof record.findings === "string" &&
      record.findings.length > MAX_AUTOMATION_FINDINGS_LENGTH
    ) {
      record.findings = record.findings.slice(0, MAX_AUTOMATION_FINDINGS_LENGTH);
      changed = true;
    }
    if (!Array.isArray(record.runs)) continue;
    for (const run of record.runs) {
      if (!run || typeof run !== "object") continue;
      const entry = run as { log?: unknown[] };
      if (!Array.isArray(entry.log)) continue;
      for (const logEntry of entry.log) {
        if (!logEntry || typeof logEntry !== "object") continue;
        const log = logEntry as { type?: string; text?: unknown; thinking?: unknown };
        if (typeof log.text === "string") {
          const cap =
            log.type === "tool" ? MAX_AUTOMATION_TOOL_RESULT_LENGTH : MAX_AUTOMATION_LOG_LENGTH;
          if (log.text.length > cap) {
            log.text = log.text.slice(0, cap);
            changed = true;
          }
        }
        if (typeof log.thinking === "string" && log.thinking.length > MAX_AUTOMATION_LOG_LENGTH) {
          log.thinking = log.thinking.slice(0, MAX_AUTOMATION_LOG_LENGTH);
          changed = true;
        }
      }
    }
  }
  return changed;
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

  // Lookup by webhook capability id — the route resolves an incoming
  // /api/webhooks/<id> POST to its automation here. Returns null for an unknown
  // or non-webhook automation (a stored webhook id is unique by construction).
  getByWebhookId(webhookId: string): Automation | null {
    return (
      this.automations.find(
        (automation) =>
          automation.trigger.kind === "webhook" && automation.trigger.id === webhookId,
      ) ?? null
    );
  }

  size(): number {
    return this.automations.length;
  }

  create(input: CreateAutomationInput): Automation {
    const now = Date.now();
    const automation: Automation = {
      id: randomUUID(),
      name: input.name,
      trigger: this.finalizeTrigger(normalizeTriggerInput(input.trigger), null),
      cwd: input.cwd,
      runner: input.runner,
      enabled: input.enabled ?? true,
      limit: input.limit ?? { kind: "forever" },
      closeOnFinish: input.closeOnFinish ?? false,
      requestedSecrets: input.requestedSecrets ?? [],
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
      ...(patch.trigger !== undefined
        ? { trigger: this.finalizeTrigger(normalizeTriggerInput(patch.trigger), current.trigger) }
        : {}),
      ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
      ...(patch.runner !== undefined ? { runner: patch.runner } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.closeOnFinish !== undefined ? { closeOnFinish: patch.closeOnFinish } : {}),
      ...(patch.requestedSecrets !== undefined ? { requestedSecrets: patch.requestedSecrets } : {}),
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

  // Cascade helper for secret deletion: strip `secretName` from every
  // automation's requestedSecrets so a deleted secret leaves no dangling
  // reference a run would silently skip. Persists only if something changed.
  // The route calls broadcastAutomations() after so clients drop the stale
  // name from their open automation forms. Pair with
  // ProcessStore.removeSecretFromAll so a secret delete cleans up both
  // containers that reference secret names.
  removeSecretFromAll(secretName: string): boolean {
    let changed = false;
    const next = this.automations.map((automation) => {
      if (!automation.requestedSecrets.includes(secretName)) return automation;
      changed = true;
      return {
        ...automation,
        requestedSecrets: automation.requestedSecrets.filter((name) => name !== secretName),
        updatedAt: Date.now(),
      };
    });
    if (changed) {
      this.automations = next;
      this.persist();
    }
    return changed;
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

  // Clear a single run's Triage unread flag (the user opened it). No-op if the
  // run is gone or already read — returns the current automation without
  // persisting in that case.
  markRunRead(id: string, runId: string): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const current = this.automations[index];
    const runIndex = current.runs.findIndex((run) => run.runId === runId);
    if (runIndex === -1) return null;
    if (!current.runs[runIndex].unread) return current;
    const runs = current.runs.map((run, position) =>
      position === runIndex ? { ...run, unread: false } : run,
    );
    const updated: Automation = { ...current, runs };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  // Clear every run's unread flag across every automation (Triage "mark all
  // read"). Persists only if anything changed; returns whether it changed so
  // the caller can skip a broadcast.
  markAllRunsRead(): boolean {
    let changed = false;
    const next = this.automations.map((automation) => {
      if (!automation.runs.some((run) => run.unread)) return automation;
      changed = true;
      return {
        ...automation,
        runs: automation.runs.map((run) => (run.unread ? { ...run, unread: false } : run)),
      };
    });
    if (changed) {
      this.automations = next;
      this.persist();
    }
    return changed;
  }

  // Clear a single automation's run history (its runs array) while keeping the
  // automation, its run-count, and lifecycle — the per-automation counterpart to
  // clearAllRuns (use reset to restart a finished automation). No-op (returns
  // the automation unchanged, no persist) if it has no runs.
  clearRuns(id: string): Automation | null {
    const index = this.automations.findIndex((automation) => automation.id === id);
    if (index === -1) return null;
    const current = this.automations[index];
    if (current.runs.length === 0) return current;
    const updated: Automation = { ...current, runs: [] };
    this.automations[index] = updated;
    this.persist();
    return updated;
  }

  // Clear every automation's run history (the runs array) while keeping the
  // automations themselves and their run-count/lifecycle (limit progress is
  // preserved — use resetAutomation to restart a finished automation). Used
  // to drop pre-log runs that have no transcript to show.
  clearAllRuns(): boolean {
    if (this.automations.every((automation) => automation.runs.length === 0)) return false;
    this.automations = this.automations.map((automation) =>
      automation.runs.length === 0 ? automation : { ...automation, runs: [] },
    );
    this.persist();
    return true;
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

  // finalizeTrigger completes a webhook trigger's id after the stateless
  // normalizeTriggerInput proposes one. On a PATCH that keeps the webhook kind,
  // the existing id is preserved so editing the command/name never rotates the
  // URL configured in CI; on a create or a kind switch into webhook, the
  // proposed id is kept unless it collides with an existing webhook (a
  // near-impossibility at WEBHOOK_ID_BYTES, but guaranteed unique here so a
  // stored id never routes ambiguously). Non-webhook triggers pass through.
  private finalizeTrigger(
    normalized: AutomationTrigger,
    existing: AutomationTrigger | null,
  ): AutomationTrigger {
    if (normalized.kind !== "webhook") return normalized;
    if (existing?.kind === "webhook") return { ...normalized, id: existing.id };
    const existingIds = new Set(
      this.automations.flatMap((automation) =>
        automation.trigger.kind === "webhook" ? [automation.trigger.id] : [],
      ),
    );
    let id = normalized.id;
    while (existingIds.has(id)) id = generateWebhookId();
    return { ...normalized, id };
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
    // Fast path: already v4. Trim any runs left above the cap by an older
    // (higher) cap and persist, so lowering the trim cap never strands a
    // user's automations behind a schema rejection.
    const v4 = automationsFileSchema.safeParse(json);
    if (v4.success) {
      this.automations = v4.data.automations;
      if (this.trimRunsToCap()) this.persist();
      return;
    }
    // Repair: an older build stored a log/findings text above the current
    // per-field cap (truncated to cap + marker), so the v4 schema rejected the
    // file and the user's automations vanished. Truncate in place + revalidate
    // so the file loads again, then persist the repaired form.
    if (repairAutomationsJson(json)) {
      const v4Repaired = automationsFileSchema.safeParse(json);
      if (v4Repaired.success) {
        this.automations = v4Repaired.data.automations;
        this.trimRunsToCap();
        this.persist();
        return;
      }
    }
    // Migrate v3 -> v4 (wrap the bare command in a shell runner), then persist
    // so later loads hit the fast path.
    const v3 = automationsFileV3Schema.safeParse(json);
    if (v3.success) {
      this.automations = v3.data.automations.map(migrateV3Automation);
      this.trimRunsToCap();
      this.persist();
      return;
    }
    // Migrate v2 -> v4 (wrap the bare schedule in a trigger), then persist so
    // later loads hit the fast path.
    const v2 = automationsFileV2Schema.safeParse(json);
    if (v2.success) {
      this.automations = v2.data.automations.map(migrateV2Automation);
      this.trimRunsToCap();
      this.persist();
      return;
    }
    // Migrate v1 -> v4 once, then persist so later loads hit the fast path.
    const v1 = automationsFileV1Schema.safeParse(json);
    if (v1.success) {
      this.automations = v1.data.automations.map(migrateV1Automation);
      this.trimRunsToCap();
      this.persist();
      return;
    }
    console.warn(`automations file invalid; starting with an empty list (${this.filePath})`);
  }

  // Trim each automation's run history to the cap (newest-first). Returns
  // whether anything was trimmed, so load() can persist only when needed.
  private trimRunsToCap(): boolean {
    let changed = false;
    for (const automation of this.automations) {
      if (automation.runs.length > AUTOMATION_RUN_HISTORY_CAP) {
        automation.runs = automation.runs.slice(0, AUTOMATION_RUN_HISTORY_CAP);
        changed = true;
      }
    }
    return changed;
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = { version: AUTOMATIONS_FILE_VERSION, automations: this.automations };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
