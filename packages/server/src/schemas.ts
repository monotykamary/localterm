import { z } from "zod";
import {
  AUTOMATION_RUN_HISTORY_CAP,
  AUTOMATION_RUN_LIMIT_MAX,
  AUTOMATIONS_FILE_VERSION,
  MAX_AUTOMATION_COMMAND_LENGTH,
  MAX_AUTOMATION_NAME_LENGTH,
  MAX_AUTOMATION_TIMES_PER_DAY,
  MAX_COLS,
  MAX_CRON_EXPRESSION_LENGTH,
  MAX_FOREGROUND_LENGTH,
  MAX_INPUT_BYTES,
  MAX_NOTIFICATION_LENGTH,
  MAX_OUTPUT_BYTES,
  MAX_ROWS,
  MAX_TITLE_LENGTH,
} from "./constants.js";

export const healthSchema = z
  .object({
    ok: z.boolean(),
    sessions: z.number().int().nonnegative(),
  })
  .strict();

const inputMessageSchema = z
  .object({
    type: z.literal("input"),
    data: z.string().max(MAX_INPUT_BYTES),
  })
  .strict();

const resizeMessageSchema = z
  .object({
    type: z.literal("resize"),
    cols: z.number().int().positive().max(MAX_COLS),
    rows: z.number().int().positive().max(MAX_ROWS),
    pixelWidth: z.number().int().nonnegative().optional(),
    pixelHeight: z.number().int().nonnegative().optional(),
  })
  .strict();

// Toggle the machine-wide keep-awake (`caffeinate -dims`). The daemon owns the
// single process; this just expresses the desired on/off state.
const caffeinateInputMessageSchema = z
  .object({
    type: z.literal("caffeinate"),
    enabled: z.boolean(),
  })
  .strict();

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  inputMessageSchema,
  resizeMessageSchema,
  caffeinateInputMessageSchema,
]);

const outputMessageSchema = z
  .object({
    type: z.literal("output"),
    data: z.string().max(MAX_OUTPUT_BYTES),
  })
  .strict();

const exitMessageSchema = z
  .object({
    type: z.literal("exit"),
    code: z.number().int().nullable(),
  })
  .strict();

const titleMessageSchema = z
  .object({
    type: z.literal("title"),
    title: z.string().max(MAX_TITLE_LENGTH),
  })
  .strict();

const sessionMessageSchema = z
  .object({
    type: z.literal("session"),
    shell: z.string().min(1),
    shellName: z.string().min(1),
    pid: z.number().int().nonnegative(),
    cwd: z.string().min(1),
    title: z.string().max(MAX_TITLE_LENGTH),
  })
  .strict();

const cwdMessageSchema = z
  .object({
    type: z.literal("cwd"),
    cwd: z.string().min(1),
  })
  .strict();

const foregroundMessageSchema = z
  .object({
    type: z.literal("foreground"),
    process: z.string().max(MAX_FOREGROUND_LENGTH).nullable(),
  })
  .strict();

const notificationMessageSchema = z
  .object({
    type: z.literal("notification"),
    body: z.string().min(1).max(MAX_NOTIFICATION_LENGTH),
  })
  .strict();

export const gitDiffFileStatusSchema = z.enum([
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
]);

// Lightweight working-tree stats polled by the browser for the diff indicator.
export const gitDiffSummarySchema = z
  .object({
    isRepo: z.boolean(),
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binaries: z.number().int().nonnegative(),
  })
  .strict();

const gitDiffSummaryMessageSchema = z
  .object({
    type: z.literal("git-diff-summary"),
    summary: gitDiffSummarySchema,
  })
  .strict();

// ----------------------------------------------------------------------------
// Automations (file format v2).
//
// A v2 automation stores a STRUCTURED schedule (friendly presets + a raw-cron
// escape hatch) instead of a bare cron string, a run-count limit + lifecycle,
// and a capped run-history array. The cron engine stays the single timing
// authority: every schedule kind compiles to one (or, for "timesOfDay",
// several) 5-field cron strings via utils/compile-schedule.ts, computed on the
// fly — no derived cron is persisted. The wire shape re-derives `cron` and the
// legacy `lastRun` for back-compat.
// ----------------------------------------------------------------------------

// Bounds mirror cron-expression.ts exactly (minute 0-59, hour 0-23, Vixie
// day-of-week 0=Sun..6=Sat, day-of-month 1-31).
const scheduleMinuteSchema = z.number().int().min(0).max(59);
const scheduleHourSchema = z.number().int().min(0).max(23);
const scheduleDayOfWeekSchema = z.number().int().min(0).max(6);
const scheduleDayOfMonthSchema = z.number().int().min(1).max(31);
const scheduleStepMinutesSchema = z.number().int().min(1).max(59);
const scheduleStepHoursSchema = z.number().int().min(1).max(23);
const scheduleTimeOfDaySchema = z
  .object({ hour: scheduleHourSchema, minute: scheduleMinuteSchema })
  .strict();

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  // "<minute> * * * *"
  z.object({ kind: z.literal("hourly"), minute: scheduleMinuteSchema }).strict(),
  // "<minute> <hour> * * *"
  z
    .object({ kind: z.literal("daily"), hour: scheduleHourSchema, minute: scheduleMinuteSchema })
    .strict(),
  // Multiple times a day -> one cron per distinct time.
  z
    .object({
      kind: z.literal("timesOfDay"),
      times: z.array(scheduleTimeOfDaySchema).min(1).max(MAX_AUTOMATION_TIMES_PER_DAY),
    })
    .strict(),
  // Weekdays/weekends -> "<minute> <hour> * * 1-5" / "<minute> <hour> * * 0,6"
  z
    .object({
      kind: z.literal("weekdaysPreset"),
      preset: z.enum(["weekdays", "weekends"]),
      hour: scheduleHourSchema,
      minute: scheduleMinuteSchema,
    })
    .strict(),
  // Specific weekdays -> "<minute> <hour> * * <sorted dow list>"
  z
    .object({
      kind: z.literal("weekly"),
      daysOfWeek: z.array(scheduleDayOfWeekSchema).min(1).max(7),
      hour: scheduleHourSchema,
      minute: scheduleMinuteSchema,
    })
    .strict(),
  // Specific days of month -> "<minute> <hour> <sorted dom list> * *"
  z
    .object({
      kind: z.literal("monthly"),
      daysOfMonth: z.array(scheduleDayOfMonthSchema).min(1).max(31),
      hour: scheduleHourSchema,
      minute: scheduleMinuteSchema,
    })
    .strict(),
  // "*/<step> * * * *"
  z.object({ kind: z.literal("everyNMinutes"), step: scheduleStepMinutesSchema }).strict(),
  // "<minute> */<step> * * *"
  z
    .object({
      kind: z.literal("everyNHours"),
      step: scheduleStepHoursSchema,
      minute: scheduleMinuteSchema,
    })
    .strict(),
  // Advanced escape hatch — raw 5-field cron, validated at the route layer.
  z
    .object({
      kind: z.literal("cron"),
      expression: z.string().min(1).max(MAX_CRON_EXPRESSION_LENGTH),
    })
    .strict(),
]);

// Create/update accept either the structured schedule or a legacy bare cron
// string (coerced to {kind:"cron"} at the store) so existing curl/skill
// consumers keep working.
export const scheduleInputSchema = z.union([
  automationScheduleSchema,
  z.string().min(1).max(MAX_CRON_EXPRESSION_LENGTH),
]);

export const automationRunLimitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("forever") }).strict(),
  z
    .object({
      kind: z.literal("count"),
      max: z.number().int().min(1).max(AUTOMATION_RUN_LIMIT_MAX),
    })
    .strict(),
]);

// "finished" = a count limit has been reached. Terminal and orthogonal to
// `enabled`; cleared only by POST /:id/reset.
export const automationLifecycleSchema = z.enum(["active", "finished"]);

export const automationRunStatusSchema = z.enum([
  "launched", // tab open requested, awaiting a WS claim
  "running", // a tab claimed the run and the command is executing
  "completed", // command finished with exit code 0
  "failed", // command finished with a non-zero exit code
  "missed", // launched but no tab claimed it before it expired (daemon WAS alive)
  "skipped", // scheduled occurrence inside a daemon-downtime window; never launched
]);

// Retained for the derived wire `lastRun`; status widened to include "skipped".
export const automationLastRunStatusSchema = automationRunStatusSchema;

export const automationRunRecordSchema = z
  .object({
    runId: z.string().min(1),
    // The intended minute boundary (ms). Equals startedAt for manual runs;
    // stable identity/sort key.
    scheduledFor: z.number().int().nonnegative(),
    // Launch-attempt time; null for a "skipped" (never-launched) run.
    startedAt: z.number().int().nonnegative().nullable(),
    // Terminal time; null while launched/running.
    finishedAt: z.number().int().nonnegative().nullable(),
    status: automationRunStatusSchema,
    exitCode: z.number().int().nullable(),
    trigger: z.enum(["schedule", "manual"]),
    // false for manual + skipped; true for scheduled launches.
    countsTowardLimit: z.boolean(),
  })
  .strict();

export const automationLastRunSchema = z
  .object({
    runId: z.string().min(1),
    at: z.number().int().nonnegative(),
    status: automationLastRunStatusSchema,
    exitCode: z.number().int().nullable(),
  })
  .strict();

// Stored shape (automations.json v2). No derived fields (cron/lastRun/nextRunAt
// live only on the wire).
const automationStoredShape = {
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
  schedule: automationScheduleSchema,
  cwd: z.string().min(1),
  command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
  enabled: z.boolean(),
  limit: automationRunLimitSchema,
  // When true, the run's browser tab is closed once the command finishes
  // (only honored for tabs opened via CDP). Defaults false → tab stays open.
  // Optional in the persisted shape so pre-existing v2 files load unchanged.
  closeOnFinish: z.boolean().default(false),
  runCount: z.number().int().nonnegative(),
  lifecycle: automationLifecycleSchema,
  runs: z.array(automationRunRecordSchema).max(AUTOMATION_RUN_HISTORY_CAP),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
};

export const automationSchema = z.object(automationStoredShape).strict();

// Wire shape: stored fields + derived nextRunAt, cron (first compiled cron,
// for display/back-compat), and lastRun (projection of runs[0]).
export const automationWithNextRunSchema = z
  .object({
    ...automationStoredShape,
    nextRunAt: z.number().int().nullable(),
    cron: z.string().min(1),
    lastRun: automationLastRunSchema.nullable(),
  })
  .strict();

export const automationsFileSchema = z
  .object({
    version: z.literal(AUTOMATIONS_FILE_VERSION),
    automations: z.array(automationSchema),
  })
  .strict();

// Frozen v1 file shape — read only by the v1->v2 migrator in automation-store.
const automationV1LastRunSchema = z
  .object({
    runId: z.string().min(1),
    at: z.number().int().nonnegative(),
    status: z.enum(["launched", "running", "completed", "failed", "missed"]),
    exitCode: z.number().int().nullable(),
  })
  .strict();

export const automationV1Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
    schedule: z.string().min(1).max(MAX_CRON_EXPRESSION_LENGTH),
    cwd: z.string().min(1),
    command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
    enabled: z.boolean(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastRun: automationV1LastRunSchema.nullable(),
  })
  .strict();

export const automationsFileV1Schema = z
  .object({
    version: z.literal(1),
    automations: z.array(automationV1Schema),
  })
  .strict();

export const createAutomationInputSchema = z
  .object({
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
    schedule: scheduleInputSchema,
    cwd: z.string().min(1),
    command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
    enabled: z.boolean().optional(),
    limit: automationRunLimitSchema.optional(),
    closeOnFinish: z.boolean().optional(),
  })
  .strict();

export const updateAutomationInputSchema = z
  .object({
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH).optional(),
    schedule: scheduleInputSchema.optional(),
    cwd: z.string().min(1).optional(),
    command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH).optional(),
    enabled: z.boolean().optional(),
    limit: automationRunLimitSchema.optional(),
    closeOnFinish: z.boolean().optional(),
  })
  .strict();

export const resetAutomationInputSchema = z
  .object({ clearHistory: z.boolean().optional() })
  .strict();

export const automationsListResponseSchema = z
  .object({ automations: z.array(automationWithNextRunSchema) })
  .strict();

const automationsMessageSchema = z
  .object({
    type: z.literal("automations"),
    automations: z.array(automationWithNextRunSchema),
  })
  .strict();

// Current keep-awake state, broadcast to every tab so the coffee toggle stays
// in lockstep. `supported` is false off macOS, where `caffeinate` does not exist.
const caffeinateStateMessageSchema = z
  .object({
    type: z.literal("caffeinate"),
    active: z.boolean(),
    supported: z.boolean(),
  })
  .strict();

export const serverToClientMessageSchema = z.discriminatedUnion("type", [
  outputMessageSchema,
  exitMessageSchema,
  titleMessageSchema,
  sessionMessageSchema,
  cwdMessageSchema,
  foregroundMessageSchema,
  notificationMessageSchema,
  gitDiffSummaryMessageSchema,
  automationsMessageSchema,
  caffeinateStateMessageSchema,
]);

export const gitDiffFileSchema = z
  .object({
    path: z.string().min(1),
    oldPath: z.string().min(1).nullable(),
    status: gitDiffFileStatusSchema,
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
    // Unified diff text for this file. Null when the file is binary or the
    // patch was dropped for size (patchOmitted distinguishes the two).
    patch: z.string().nullable(),
    patchOmitted: z.boolean(),
  })
  .strict();

export const gitDiffResponseSchema = z
  .object({
    isRepo: z.boolean(),
    files: z.array(gitDiffFileSchema),
  })
  .strict();
