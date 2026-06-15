import { z } from "zod";
import {
  AUTOMATION_RUN_HISTORY_CAP,
  AUTOMATION_RUN_LIMIT_MAX,
  AUTOMATIONS_FILE_VERSION,
  CAFFEINATE_PREFERENCES_FILE_VERSION,
  MAX_AUTOMATION_COMMAND_LENGTH,
  MAX_AUTOMATION_NAME_LENGTH,
  MAX_AUTOMATION_TIMES_PER_DAY,
  MAX_AUTOMATION_WATCH_FILTER_LENGTH,
  MAX_CAFFEINATE_COMMAND_LENGTH,
  MAX_CAFFEINATE_COMMANDS,
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

// Keep-awake (`caffeinate -dims`) has three modes. "off" never caffeinates,
// "on" always does, and "automatic" caffeinates only while a recognized program
// is running in some localterm session.
export const caffeinateModeSchema = z.enum(["off", "on", "automatic"]);

// One trigger command for automatic mode. Matched against the basename of each
// token in a running process's command line (so `node …/claude` counts).
const caffeinateCommandSchema = z.string().trim().min(1).max(MAX_CAFFEINATE_COMMAND_LENGTH);

// Set the machine-wide keep-awake mode. The daemon owns the single process and
// decides when it actually runs; this just expresses the desired mode.
const caffeinateModeInputMessageSchema = z
  .object({
    type: z.literal("caffeinate-mode"),
    mode: caffeinateModeSchema,
  })
  .strict();

// Replace the user's custom automatic-mode trigger commands (on top of the
// fixed defaults, which are never sent from the client).
const caffeinateCommandsInputMessageSchema = z
  .object({
    type: z.literal("caffeinate-commands"),
    commands: z.array(caffeinateCommandSchema).max(MAX_CAFFEINATE_COMMANDS),
  })
  .strict();

// Toggle the activity gate for automatic mode. When enabled (the default),
// caffeinate only stays active while a recognized program is producing output;
// after CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS of silence caffeinate releases.
const caffeinateActivityGateInputMessageSchema = z
  .object({
    type: z.literal("caffeinate-activity-gate"),
    enabled: z.boolean(),
  })
  .strict();

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  inputMessageSchema,
  resizeMessageSchema,
  caffeinateModeInputMessageSchema,
  caffeinateCommandsInputMessageSchema,
  caffeinateActivityGateInputMessageSchema,
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

// Per-file metadata for the diff viewer's file list. The patch body is fetched
// lazily per file (gitDiffFilePatchSchema) so opening the viewer never blocks on
// generating every changed file's diff.
export const gitDiffFileMetaSchema = z
  .object({
    path: z.string().min(1),
    oldPath: z.string().min(1).nullable(),
    status: gitDiffFileStatusSchema,
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
  })
  .strict();

export const gitDiffFileListResponseSchema = z
  .object({
    isRepo: z.boolean(),
    files: z.array(gitDiffFileMetaSchema),
  })
  .strict();

// One file's unified diff text, fetched on demand. patch is null when the file
// is binary or the patch was dropped for size (patchOmitted distinguishes them).
export const gitDiffFilePatchSchema = z
  .object({
    patch: z.string().nullable(),
    patchOmitted: z.boolean(),
    binary: z.boolean(),
  })
  .strict();

// Lightweight working-tree stats pushed to the browser for the diff indicator.
// `branch` is the current branch (null when detached / not a repo); the client
// watches it to refresh the ambient PR lease only when the branch actually
// changes, not on every working-tree edit.
export const gitDiffSummarySchema = z
  .object({
    isRepo: z.boolean(),
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binaries: z.number().int().nonnegative(),
    branch: z.string().nullable(),
  })
  .strict();

const gitDiffSummaryMessageSchema = z
  .object({
    type: z.literal("git-diff-summary"),
    summary: gitDiffSummarySchema,
  })
  .strict();

// Which diff the viewer is asking for. "working" is the working tree vs HEAD
// (the ambient, always-available diff). "branch" compares the working tree
// against a base branch via merge-base — committed changes on this branch plus
// any uncommitted/untracked work on top, i.e. "what this PR adds, plus where I
// am right now".
export const gitDiffModeSchema = z.enum(["working", "branch"]);

// The PR (if any) the current branch maps to, discovered via `gh`. Null whenever
// gh is missing, unauthenticated, or there's no PR for the branch. `state`
// distinguishes an open PR from an already merged/closed one (both are surfaced).
export const gitBranchPrStateSchema = z.enum(["open", "closed", "merged"]);

export const gitBranchPrSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    baseRefName: z.string().min(1),
    url: z.string().min(1).nullable(),
    state: gitBranchPrStateSchema,
  })
  .strict();

// How the default base branch was resolved, surfaced so the UI can explain the
// preselected comparison ("base of PR #12", "repo default branch", …).
export const gitBaseSourceSchema = z.enum(["pr", "remoteHead", "fallback"]);

// Everything the base-branch picker needs: the candidate refs, the preselected
// default (a concrete, existing ref), and the detected PR. defaultBase is null
// when no plausible base could be found (e.g. a brand-new repo with one branch).
export const gitBranchInfoSchema = z
  .object({
    isRepo: z.boolean(),
    currentBranch: z.string().min(1).nullable(),
    defaultBase: z.string().min(1).nullable(),
    defaultBaseSource: gitBaseSourceSchema.nullable(),
    branches: z.array(z.string().min(1)),
    pr: gitBranchPrSchema.nullable(),
  })
  .strict();

// ----------------------------------------------------------------------------
// Automations (file format v3).
//
// An automation stores a STRUCTURED schedule (friendly presets + a raw-cron
// escape hatch) instead of a bare cron string, a run-count limit + lifecycle,
// and a capped run-history array. In v3 the schedule is wrapped in a top-level
// `trigger` union so an automation can fire on a schedule OR when a folder
// changes. The cron engine stays the single timing authority for SCHEDULE
// triggers: every schedule kind compiles to one (or, for "timesOfDay", several)
// 5-field cron strings via utils/compile-schedule.ts, computed on the fly — no
// derived cron is persisted. WATCH triggers are event-driven (fs.watch) and
// have no cron / next-run. The wire shape re-derives `cron` (null for watch)
// and the legacy `lastRun` for back-compat.
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

// What causes an automation to run. A "schedule" trigger is time-based (the
// cron engine compiles it on the fly); a "watch" trigger fires when the
// automation's cwd changes, observed via native fs.watch — event-driven, never
// polled; an "event" trigger fires when a localterm session emits a named
// event (git-dirty, git-refs-change, notification, cwd, foreground, exit) whose cwd matches
// the automation's cwd or is inside it. `recursive` watches the whole subtree.
// Only schedule triggers carry a cron / next-run.
export const automationSessionEventSchema = z.enum([
  "git-dirty",
  "git-refs-change",
  "notification",
  "cwd",
  "foreground",
  "exit",
]);

export const automationTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("schedule"), schedule: automationScheduleSchema }).strict(),
  z
    .object({
      kind: z.literal("watch"),
      recursive: z.boolean(),
      filter: z.string().min(1).max(MAX_AUTOMATION_WATCH_FILTER_LENGTH).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("event"), event: automationSessionEventSchema }).strict(),
]);

// Create/update accept either the structured schedule or a legacy bare cron
// string (coerced to {kind:"cron"} at the store) so existing curl/skill
// consumers keep working.
export const scheduleInputSchema = z.union([
  automationScheduleSchema,
  z.string().min(1).max(MAX_CRON_EXPRESSION_LENGTH),
]);

// Trigger as accepted on the wire: the schedule payload accepts the legacy bare
// cron string too, `recursive` is optional (defaults true at the store), and
// the event trigger accepts a session event name.
export const triggerInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("schedule"), schedule: scheduleInputSchema }).strict(),
  z
    .object({
      kind: z.literal("watch"),
      recursive: z.boolean().optional(),
      filter: z.string().min(1).max(MAX_AUTOMATION_WATCH_FILTER_LENGTH).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("event"), event: automationSessionEventSchema }).strict(),
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
    trigger: z.enum(["schedule", "manual", "watch", "event"]),
    // false for manual + skipped; true for scheduled + watch launches.
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

// Stored shape (automations.json v3). No derived fields (cron/lastRun/nextRunAt
// live only on the wire).
const automationStoredShape = {
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
  trigger: automationTriggerSchema,
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
// for display/back-compat), and lastRun (projection of runs[0]). nextRunAt and
// cron are null for watch triggers (no time-based schedule).
export const automationWithNextRunSchema = z
  .object({
    ...automationStoredShape,
    nextRunAt: z.number().int().nullable(),
    cron: z.string().min(1).nullable(),
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

// Frozen v2 file shape — read only by the v2->v3 migrator. v2 stored the
// trigger as a bare top-level `schedule`; v3 wraps it in a `trigger` union.
// (runs[].trigger only ever held "schedule"/"manual" in v2, which still parse
// under the widened v3 enum.)
export const automationV2Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
    schedule: automationScheduleSchema,
    cwd: z.string().min(1),
    command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
    enabled: z.boolean(),
    limit: automationRunLimitSchema,
    closeOnFinish: z.boolean().default(false),
    runCount: z.number().int().nonnegative(),
    lifecycle: automationLifecycleSchema,
    runs: z.array(automationRunRecordSchema).max(AUTOMATION_RUN_HISTORY_CAP),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const automationsFileV2Schema = z
  .object({
    version: z.literal(2),
    automations: z.array(automationV2Schema),
  })
  .strict();

export const createAutomationInputSchema = z
  .object({
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
    trigger: triggerInputSchema,
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
    trigger: triggerInputSchema.optional(),
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

// Current keep-awake state, broadcast to every tab so the coffee control stays
// in lockstep. `supported` is false off macOS, where `caffeinate` does not
// exist. `active` is whether the process is running right now (drives the icon
// tint); `mode` is the selected off/on/automatic. `activityGate` is whether
// automatic mode requires recent stdout from a recognized program (defaults
// true). `defaultCommands` are the fixed automatic triggers (shown read-only);
// `commands` are the user's additions.
const caffeinateStateMessageSchema = z
  .object({
    type: z.literal("caffeinate"),
    supported: z.boolean(),
    active: z.boolean(),
    mode: caffeinateModeSchema,
    activityGate: z.boolean(),
    defaultCommands: z.array(z.string()),
    commands: z.array(z.string()),
  })
  .strict();

// Persisted keep-awake preferences (~/.localterm/caffeinate.json).
export const caffeinatePreferencesFileSchema = z
  .object({
    version: z.literal(CAFFEINATE_PREFERENCES_FILE_VERSION),
    mode: caffeinateModeSchema,
    activityGate: z.boolean(),
    commands: z.array(caffeinateCommandSchema).max(MAX_CAFFEINATE_COMMANDS),
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

export const gitDiffFileSchema = gitDiffFileMetaSchema
  .extend({
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
