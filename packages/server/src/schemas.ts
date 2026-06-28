import { z } from "zod";
import {
  AUTOMATION_RUN_HISTORY_CAP,
  AUTOMATION_RUN_LIMIT_MAX,
  AUTOMATIONS_FILE_VERSION,
  CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT,
  CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT,
  CAFFEINATE_PREFERENCES_FILE_VERSION,
  MAX_AUTOMATION_COMMAND_LENGTH,
  MAX_AUTOMATION_NAME_LENGTH,
  MAX_AUTOMATION_TIMES_PER_DAY,
  MAX_AUTOMATION_WATCH_FILTER_LENGTH,
  MAX_WEBHOOK_ID_LENGTH,
  MAX_CAFFEINATE_COMMAND_LENGTH,
  MAX_CAFFEINATE_COMMANDS,
  MAX_COLS,
  MAX_CRON_EXPRESSION_LENGTH,
  MAX_FOREGROUND_LENGTH,
  MAX_INPUT_BYTES,
  MAX_LAUNCH_COMMAND_LENGTH,
  MAX_NOTIFICATION_LENGTH,
  MAX_ROWS,
  MAX_TAB_TOKEN_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_WORKTREEINCLUDE_FILE_BYTES,
  MAX_WORKTREE_OPEN_IN_COMMANDS,
  MAX_WORKTREE_OPEN_IN_COMMAND_LENGTH,
  MAX_WORKTREE_OPEN_IN_ID_LENGTH,
  MAX_WORKTREE_OPEN_IN_LABEL_LENGTH,
  MAX_WORKTREE_PR_NUMBER,
  MAX_WORKTREE_SETUP_SCRIPT_LENGTH,
  TCP_PORT_MAX,
  WORKTREE_CONFIG_FILE_VERSION,
} from "./constants.js";

// Live state of the daemon's persistent CDP connection (browser tab control for
// automations). `null` when the CDP path is disabled entirely (a caller injected
// its own `tabController`, or `LOCALTERM_DISABLE_CDP_TABS=1`); otherwise whether
// the one socket opened at `start` is currently attached, plus the browser it
// attached to. Surfaces the CDP-less vs CDP mode to `localterm status` and the
// automations UI so the user can tell whether run tabs background + close.
export const cdpHealthSchema = z
  .object({
    connected: z.boolean(),
    browser: z.string().optional(),
  })
  .nullable();

export const healthSchema = z
  .object({
    ok: z.boolean(),
    sessions: z.number().int().nonnegative(),
    cdp: cdpHealthSchema,
  })
  .strict();

// One row in the session picker: a live PTY the user can attach to. `clients`
// is the count of currently-attached sockets (0 = dormant — alive but no one
// viewing it, the row the picker exists to surface). `state` is the
// favicon-equivalent activity (running = recent output, alive-quiet = a
// foreground program but quiet, ready = idle) so the row icon colors match the
// tab the user is looking at and gate the grace reap. `lastOutputAt` is the
// last PTY output time, exposed so the picker can sort by recency of activity.
// The current tab matches on `id` against the session frame it received.
export const sessionActivityStateSchema = z.enum(["running", "alive-quiet", "ready"]);

export const sessionListItemSchema = z
  .object({
    id: z.string().uuid(),
    pid: z.number().int().nonnegative(),
    shell: z.string().min(1),
    shellName: z.string().min(1),
    cwd: z.string().min(1),
    title: z.string().max(MAX_TITLE_LENGTH),
    createdAt: z.number().int().nonnegative(),
    lastOutputAt: z.number().int().nonnegative(),
    clients: z.number().int().nonnegative(),
    state: sessionActivityStateSchema,
  })
  .strict();

export const sessionsListResponseSchema = z
  .object({ sessions: z.array(sessionListItemSchema) })
  .strict();

// One row in the ports modal: a TCP listening socket owned by a process
// descended from a localterm session shell (a dev server run inside a tab).
// `pid` is the process holding the socket (the dev server, e.g. the `node`
// running vite) — killing it stops the dev server and returns the shell to its
// prompt. `address` is lsof's bind address (`*` for all interfaces, `127.0.0.1`
// / `[::1]` for loopback). `sessionTitle`/`cwd` belong to the shell the dev server
// descends from so the modal can badge the owning session without a second
// fetch; a port's owning session is always live (the shell the dev server is a
// child of).
export const listeningPortSchema = z
  .object({
    port: z.number().int().min(1).max(TCP_PORT_MAX),
    address: z.string().min(1),
    pid: z.number().int().nonnegative(),
    processName: z.string().min(1),
    sessionId: z.string().uuid(),
    sessionTitle: z.string().max(MAX_TITLE_LENGTH),
    cwd: z.string().min(1),
  })
  .strict();

export const listeningPortsResponseSchema = z
  .object({ ports: z.array(listeningPortSchema) })
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

// Set the battery floor for keep-awake. When the machine is on battery power
// at or below `percent`, the daemon stops caffeinate without changing the
// selected mode; `null` disables the guard entirely.
const caffeinateBatteryThresholdInputMessageSchema = z
  .object({
    type: z.literal("caffeinate-battery-threshold"),
    percent: z
      .number()
      .int()
      .min(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT)
      .max(CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT)
      .nullable(),
  })
  .strict();

// Ambient tab provenance. The page reads window[LOCALTERM_TAB_TOKEN_PROPERTY]
// (injected by the daemon via CDP) and echoes it here on WS-open (and again on
// the 'localterm-token' event if injection arrives after the WS connects).
// `token:null` means injection hasn't landed yet — the server waits for a
// follow-up identify with the real token rather than pairing eagerly.
const identifyMessageSchema = z
  .object({
    type: z.literal("identify"),
    token: z.string().min(1).max(MAX_TAB_TOKEN_LENGTH).nullable(),
  })
  .strict();

// Attach handshake. After the server sends the {type:"session"} frame the
// client tells the manager whether this socket is caught up. `replay:true` asks
// for the session's scrollback ring buffer (a tab switching to this PTY from a
// different one — it reset its screen and needs the recent output); the server
// sends it as one binary frame ahead of live fan-out. `replay:false` (a silent
// reattach of the same PTY, or a brand-new spawn with no history) skips the
// replay and goes straight to live output. Until this lands the socket stays
// "pending" and receives no live fan-out, so no output is lost across the gap —
// it all lives in the ring buffer and arrives via the replay.
const readyMessageSchema = z
  .object({
    type: z.literal("ready"),
    replay: z.boolean(),
  })
  .strict();

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  inputMessageSchema,
  resizeMessageSchema,
  caffeinateModeInputMessageSchema,
  caffeinateCommandsInputMessageSchema,
  caffeinateActivityGateInputMessageSchema,
  caffeinateBatteryThresholdInputMessageSchema,
  identifyMessageSchema,
  readyMessageSchema,
]);

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
    // Server-side id for the live PTY. A reconnecting or switching client
    // carries it back as the `sid` query param on the WS url so the daemon
    // attaches to the live PTY instead of spawning a fresh shell. Optional
    // for back-compat with older clients.
    id: z.string().uuid().optional(),
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
// `mergeable` mirrors GitHub's `mergeable` field, surfaced as a concrete enum so
// the client can badge conflicted PRs without an extra round-trip.
export const gitBranchPrStateSchema = z.enum(["open", "closed", "merged"]);
export const gitBranchPrMergeableSchema = z.enum(["mergeable", "conflicting", "unknown"]);

export const gitBranchPrSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    baseRefName: z.string().min(1),
    // Server-resolved comparison ref — the PR's base branch mapped to a local
    // remote-tracking ref. A same-repo PR resolves to <origin>/<baseRefName>; a
    // fork PR to <upstream>/<baseRefName> (the repo the PR actually targets), so
    // the UI picker and the diff agree on the base. Null when the base repo
    // isn't a configured remote or its ref couldn't be fetched — callers fall
    // back to the repo default.
    baseRef: z.string().min(1).nullable(),
    url: z.string().min(1).nullable(),
    state: gitBranchPrStateSchema,
    isDraft: z.boolean(),
    mergeable: gitBranchPrMergeableSchema,
    // ISO 8601 timestamp from GitHub's `merged_at` (null for open/closed PRs).
    // Drives the client's merged-PR overlay TTL: a merged PR stops surfacing in
    // the toolbar/diff-viewer once it's older than the TTL window.
    mergedAt: z.string().datetime().nullable(),
  })
  .strict();

// How the default base branch was resolved, surfaced so the UI can explain the
// preselected comparison ("base of PR #12", "repo default branch", …).
export const gitBaseSourceSchema = z.enum(["pr", "remoteHead", "fallback"]);

// Everything the base-branch picker needs: the candidate refs, the preselected
// default (a concrete, existing ref), and the detected PR. defaultBase is null
// when no plausible base could be found (e.g. a brand-new repo with one branch).
// `pr` is always null from /api/git/branches (the fast local lease); the client
// fills it from the separate /api/git/branches/pr lease (see gitBranchPrLeaseSchema).
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

// The PR lease: just the detected PR for the current branch (null when none /
// gh is missing / unauthenticated / the GitHub call fails). Served by the
// dedicated /api/git/branches/pr endpoint so it never blocks the fast branch
// lease; the client merges `pr` into its branch-info lease.
export const gitBranchPrLeaseSchema = z
  .object({
    pr: gitBranchPrSchema.nullable(),
  })
  .strict();

// One entry from `git worktree list --porcelain`. `path` is the worktree root
// (absolute, as git prints it) — kept absolute so the client can pass it back
// for actions (open a shell there, remove it). `displayPath` is the same path
// tildified against the daemon's home, for display only (the browser can't
// resolve home itself). `branch` is the short ref checked out there (null when
// detached). `head` is the commit sha (null before the first commit).
// `isCurrent` marks the worktree the caller's cwd lives in. `isMain` marks the
// repository's primary worktree (the one holding the common .git dir) — it is
// never removable, so the client hides its delete action and the server guards
// removal. `isLocked` / `isPrunable` mirror git's own markers (a locked
// worktree is exempt from auto-pruning; prunable means git thinks it can be
// cleaned up).
export const gitWorktreeSchema = z
  .object({
    path: z.string().min(1),
    displayPath: z.string().min(1),
    branch: z.string().min(1).nullable(),
    head: z.string().nullable(),
    isCurrent: z.boolean(),
    isMain: z.boolean(),
    isLocked: z.boolean(),
    isPrunable: z.boolean(),
  })
  .strict();

// All worktrees sharing the caller's repo. `git worktree list` run from any
// worktree of a repo returns the whole linked set, so this single read is the
// complete project view — no store, no per-worktree tracking. `displayBaseDir`
// is the tildified dir under which auto-created worktrees land
// (~/.localterm/worktrees/<project>), shown by the create form so the user
// knows where the next worktree will go before creating it.
export const gitWorktreeListResponseSchema = z
  .object({
    isRepo: z.boolean(),
    worktrees: z.array(gitWorktreeSchema),
    displayBaseDir: z.string().nullable(),
  })
  .strict();

// A completed create: the resolved absolute worktree path and the branch now
// checked out there. `setupCommand` is the repo's configured setup script
// (null when none) the client should run as the new tab's initial command so
// env copy / installs run visibly in the right shell; `copiedFiles` are the
// gitignored files `.worktreeinclude` copied from the main worktree.
export const gitWorktreeResultSchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().min(1),
    setupCommand: z.string().nullable(),
    copiedFiles: z.array(z.string()),
  })
  .strict();

// The ref new worktrees branch from. "fresh" branches from origin/HEAD
// (fetching first if needed) so each worktree starts from the remote default;
// "head" branches from the local HEAD so a worktree carries in-progress,
// unpushed work. "head" is what pre-config worktrees did (branch from HEAD).
export const gitWorktreeBaseRefSchema = z.enum(["fresh", "head"]);

// Body for POST /api/git/worktrees. Absent fields fall back to the repo's
// configured defaults. `pullRequestNumber` (a GitHub PR number) overrides the
// base ref: the worktree is created from pull/<N>/head on a `pr-<N>` branch.
export const createWorktreeInputSchema = z
  .object({
    baseRef: gitWorktreeBaseRefSchema.optional(),
    pullRequestNumber: z.number().int().positive().max(MAX_WORKTREE_PR_NUMBER).optional(),
  })
  .strict();

// A custom "Open in…" launcher for a worktree row. `command` is run detached
// in the worktree's cwd via the user's login shell (so `code .`, `zed .`,
// `fork .` resolve); `label` is the button text. `id` is client-stable so the
// editor can key rows and reconcile edits.
export const worktreeOpenInCommandSchema = z
  .object({
    id: z.string().min(1).max(MAX_WORKTREE_OPEN_IN_ID_LENGTH),
    label: z.string().trim().min(1).max(MAX_WORKTREE_OPEN_IN_LABEL_LENGTH),
    command: z.string().trim().min(1).max(MAX_WORKTREE_OPEN_IN_COMMAND_LENGTH),
  })
  .strict();

// Stored per-repo worktree config shape (~/.localterm/worktree-configs/
// <repo-id>.json v1). All fields default to empty/off so a fresh repo behaves
// like pre-config worktrees: no setup, no open-in commands, base ref "fresh"
// (new worktrees branch from origin/HEAD when a remote exists, else HEAD).
export const worktreeRepoConfigFileSchema = z
  .object({
    version: z.literal(WORKTREE_CONFIG_FILE_VERSION),
    setupScript: z.string().max(MAX_WORKTREE_SETUP_SCRIPT_LENGTH),
    openInCommands: z.array(worktreeOpenInCommandSchema).max(MAX_WORKTREE_OPEN_IN_COMMANDS),
    baseRef: gitWorktreeBaseRefSchema,
  })
  .strict();

// Wire shape for GET/PUT /api/git/worktrees/config: the stored fields without
// the version tag (the store owns versioning). PUT accepts a partial of this.
export const worktreeRepoConfigSchema = z
  .object({
    setupScript: z.string().max(MAX_WORKTREE_SETUP_SCRIPT_LENGTH),
    openInCommands: z.array(worktreeOpenInCommandSchema).max(MAX_WORKTREE_OPEN_IN_COMMANDS),
    baseRef: gitWorktreeBaseRefSchema,
  })
  .strict();

export const updateWorktreeConfigInputSchema = z
  .object({
    setupScript: z.string().max(MAX_WORKTREE_SETUP_SCRIPT_LENGTH).optional(),
    openInCommands: z
      .array(worktreeOpenInCommandSchema)
      .max(MAX_WORKTREE_OPEN_IN_COMMANDS)
      .optional(),
    baseRef: gitWorktreeBaseRefSchema.optional(),
  })
  .strict();

// Wire shape for GET /api/git/worktrees/include-file: the content of the repo's
// `.worktreeinclude` file (gitignore-syntax), plus whether it currently exists.
// The path is always the constant filename; included so the UI can label it
// without hard-coding the name.
export const worktreeIncludeFileSchema = z
  .object({
    exists: z.boolean(),
    content: z.string().max(MAX_WORKTREEINCLUDE_FILE_BYTES),
    path: z.string().min(1),
  })
  .strict();

// Body for PUT /api/git/worktrees/include-file. Empty string removes the file.
export const worktreeIncludeFileInputSchema = z
  .object({
    content: z.string().max(MAX_WORKTREEINCLUDE_FILE_BYTES),
  })
  .strict();

// A completed sweep: the worktree paths removed. Skipped (dirty / unpushed /
// too new / manual) worktrees are left untouched and not enumerated.
export const worktreeSweepResultSchema = z.object({ removed: z.array(z.string().min(1)) }).strict();

// Body for POST /api/launch: run `command` detached in `cwd` via the login
// shell. Used by the "Open in…" menu to launch external editors/GUI git
// clients at a worktree. The daemon already hands out unrestricted shells, so
// running a user-configured command is not an escalation.
export const launchInputSchema = z
  .object({
    cwd: z.string().min(1),
    command: z.string().trim().min(1).max(MAX_LAUNCH_COMMAND_LENGTH),
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
// event (git-commit, git-checkout, notification, cwd, foreground, exit) whose cwd matches
// the automation's cwd or is inside it. `recursive` watches the whole subtree.
// A "webhook" trigger fires when an external POST hits /api/webhooks/<id> —
// the id is a server-generated capability token (single-segment, url-safe),
// Discord-style: anyone with the URL can fire the automation. Only schedule
// triggers carry a cron / next-run.
// Session events that can drive an event-triggered automation. These are the
// user-selectable events; internal signals such as `git-dirty` are deliberately
// excluded because they are too coarse for automation triggers.
export const AUTOMATION_SESSION_EVENTS = [
  "git-head-change",
  "git-branch-change",
  "git-tag-change",
  "git-remote-change",
  "git-stash-change",
  "git-commit",
  "git-checkout",
  "git-reset",
  "git-merge",
  "git-rebase",
  "git-cherry-pick",
  "git-fetch",
  "git-stash",
  "git-tag",
  "notification",
  "cwd",
  "foreground",
  "exit",
] as const satisfies [string, ...string[]];

export const automationSessionEventSchema = z.enum(AUTOMATION_SESSION_EVENTS);

export const automationTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("schedule"), schedule: automationScheduleSchema }).strict(),
  z
    .object({
      kind: z.literal("watch"),
      recursive: z.boolean(),
      filter: z.string().min(1).max(MAX_AUTOMATION_WATCH_FILTER_LENGTH).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("event"),
      events: z.array(automationSessionEventSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("webhook"),
      id: z
        .string()
        .min(1)
        .max(MAX_WEBHOOK_ID_LENGTH)
        .regex(/^[A-Za-z0-9_-]+$/),
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

// Trigger as accepted on the wire: the schedule payload accepts the legacy bare
// cron string too, `recursive` is optional (defaults true at the store), the
// event trigger accepts one or more session event names, and the webhook
// trigger carries no client input — the id is server-generated on create and
// preserved across PATCHes that keep the webhook kind.
export const triggerInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("schedule"), schedule: scheduleInputSchema }).strict(),
  z
    .object({
      kind: z.literal("watch"),
      recursive: z.boolean().optional(),
      filter: z.string().min(1).max(MAX_AUTOMATION_WATCH_FILTER_LENGTH).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("event"),
      events: z.array(automationSessionEventSchema).min(1),
    })
    .strict(),
  z.object({ kind: z.literal("webhook") }).strict(),
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
    trigger: z.enum(["schedule", "manual", "watch", "event", "webhook"]),
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
// true). `batteryThreshold` is the percent floor at which keep-awake stops on
// battery power, or null when the guard is off (defaults 20). `defaultCommands`
// are the fixed automatic triggers (shown read-only); `commands` are the user's
// additions.
// Server tells the client whether this socket is paired with a CDP target —
// i.e. whether the daemon can reliably closeTab on shell exit. Drives the
// client's markShellDead path: a CDP-controlled clean exit waits for the
// server-driven close instead of front-running with window.close().
// Marks the end of a scrollback replay. Sent after the replay binary frame(s)
// (or immediately, when the snapshot was empty) so the client knows the replay
// bytes have all landed and can write them as one suppressed block — dropping
// xterm's responses to the stale query requests in the ring buffer so they
// never reach the live PTY. Sent on every promote, not only `ready { replay:
// true }`: the client opens its suppressed-replay window on the {session} frame
// (before its {ready} can race back over a slow link), so a pending-timeout
// auto-promote with `replay: false` must still send the marker or the client
// deadlocks waiting for it. A client that never opened the window (a silent
// reattach, or a back-compat reader) treats it as a no-op.
const replayEndMessageSchema = z.object({ type: z.literal("replay-end") }).strict();

const cdpControlledMessageSchema = z
  .object({
    type: z.literal("cdp-controlled"),
    controlled: z.boolean(),
  })
  .strict();

const caffeinateStateMessageSchema = z
  .object({
    type: z.literal("caffeinate"),
    supported: z.boolean(),
    active: z.boolean(),
    mode: caffeinateModeSchema,
    activityGate: z.boolean(),
    batteryThreshold: z
      .number()
      .int()
      .min(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT)
      .max(CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT)
      .nullable(),
    defaultCommands: z.array(z.string()),
    commands: z.array(z.string()),
    activeTrigger: z.string().nullable(),
  })
  .strict();

// Persisted keep-awake preferences (~/.localterm/caffeinate.json).
export const caffeinatePreferencesFileSchema = z
  .object({
    version: z.literal(CAFFEINATE_PREFERENCES_FILE_VERSION),
    mode: caffeinateModeSchema,
    activityGate: z.boolean(),
    batteryThreshold: z
      .number()
      .int()
      .min(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT)
      .max(CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT)
      .nullable(),
    commands: z.array(caffeinateCommandSchema).max(MAX_CAFFEINATE_COMMANDS),
  })
  .strict();

export const serverToClientMessageSchema = z.discriminatedUnion("type", [
  // NOTE: PTY output is NOT a JSON member of this union. The server emits output
  // as a binary WebSocket frame (raw UTF-8 bytes via sendOutputBytes in index.ts).
  // The client dispatches by `event.data instanceof ArrayBuffer` in terminal.tsx
  // and hands the bytes directly to OutputBatcher, bypassing JSON.parse. JSON
  // stringify/parse of `{ type: "output", data: "..." }` was the dominant
  // per-byte cost on the renderer main thread (traced: ~36% of main-thread
  // busy in steady-state stream, scaling linearly with payload size due to
  // per-character escape scanning on both sides).
  exitMessageSchema,
  titleMessageSchema,
  sessionMessageSchema,
  cwdMessageSchema,
  foregroundMessageSchema,
  notificationMessageSchema,
  gitDiffSummaryMessageSchema,
  automationsMessageSchema,
  caffeinateStateMessageSchema,
  cdpControlledMessageSchema,
  replayEndMessageSchema,
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
