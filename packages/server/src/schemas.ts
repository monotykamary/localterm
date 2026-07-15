import { z } from "zod";
import {
  AUTOMATION_RUN_HISTORY_SCHEMA_MAX,
  AUTOMATION_RUN_LIMIT_MAX,
  AUTOMATIONS_FILE_VERSION,
  CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT,
  CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT,
  CAFFEINATE_PREFERENCES_FILE_VERSION,
  DAEMON_CONFIG_FILE_VERSION,
  WORKSPACE_FILE_VERSION,
  EXEC_MAX_OUTPUT_LIMIT_BYTES,
  EXEC_MAX_TIMEOUT_MS,
  MAX_AUTOMATION_CHANGED_FILES,
  MAX_AUTOMATION_COMMAND_LENGTH,
  MAX_AUTOMATION_FINDINGS_LENGTH,
  MAX_AUTOMATION_LOG_ENTRIES,
  MAX_AUTOMATION_LOG_LENGTH,
  MAX_AUTOMATION_MODEL_LENGTH,
  MAX_AUTOMATION_NAME_LENGTH,
  MAX_AUTOMATION_PROMPT_LENGTH,
  MAX_AUTOMATION_TOOL_INPUT_LENGTH,
  MAX_AUTOMATION_TOOL_RESULT_LENGTH,
  MAX_AUTOMATION_REQUESTED_SECRETS,
  MAX_AUTOMATION_TIMES_PER_DAY,
  MAX_AUTOMATION_WATCH_FILTER_LENGTH,
  MAX_SECRET_ENV_VAR_LENGTH,
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  SECRET_EXPORT_VERSION,
  MAX_SECRET_EXPORT_PASSPHRASE_LENGTH,
  MAX_SECRETS,
  MAX_PROCESS_NAME_LENGTH,
  MAX_PROCESS_REQUESTED_SECRETS,
  MAX_PROCESSES,
  MAX_CUSTOM_THEMES,
  MAX_THEME_NAME_LENGTH,
  MAX_THEME_ID_LENGTH,
  MAX_THEME_SOURCE_LENGTH,
  MAX_THEME_IMPORT_TEXT_LENGTH,
  FONTS_FILE_VERSION,
  MAX_FONT_ID_LENGTH,
  MAX_CUSTOM_FONT_FAMILY_LENGTH,
  PROCESSES_FILE_VERSION,
  SECRETS_FILE_VERSION,
  THEMES_FILE_VERSION,
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
  MAX_SHELL_PATH_LENGTH,
  MAX_TAB_TOKEN_LENGTH,
  MAX_WINDOW_ID_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_WORKTREEINCLUDE_FILE_BYTES,
  MAX_WORKTREE_OPEN_IN_COMMANDS,
  MAX_WORKTREE_OPEN_IN_COMMAND_LENGTH,
  MAX_WORKTREE_OPEN_IN_ID_LENGTH,
  MAX_WORKTREE_OPEN_IN_LABEL_LENGTH,
  MAX_WORKTREE_PR_NUMBER,
  MAX_WORKTREE_SETUP_SCRIPT_LENGTH,
  SESSION_GRACE_MAX_SECONDS,
  SESSION_GRACE_MIN_SECONDS,
  TCP_PORT_MAX,
  WORKTREE_CONFIG_FILE_VERSION,
  WAIT_MAX_TIMEOUT_MS,
  IDENTITY_HEADER_NAME_MAX_LENGTH,
  IDENTITY_PROXY_SPEC_MAX_LENGTH,
  IDENTITY_RP_NAME_MAX_LENGTH,
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
    // Port of the connected browser's debug endpoint, when known (from the
    // DevToolsActivePort file or the explicit `/json/version` probe). Surfaced
    // so the settings UI can show which endpoint the daemon attached to.
    port: z.number().int().positive().optional(),
  })
  .nullable();

export const healthSchema = z
  .object({
    ok: z.boolean(),
    sessions: z.number().int().nonnegative(),
    cdp: cdpHealthSchema,
  })
  .strict();

// Result of `GET /api/update-status` — the daemon's cached npm update check.
// `latest`/`checkedAt` are null before the first successful fetch; `current` is
// the version the running daemon reports. The CLI banner resolves this with
// `?wait=1` (blocks on a fresh fetch when the cache is stale); browser tabs
// poll it without `wait` and read the non-blocking cache.
export const updateStatusSchema = z
  .object({
    current: z.string(),
    latest: z.string().nullable(),
    updateAvailable: z.boolean(),
    checkedAt: z.number().int().nullable(),
  })
  .strict();

// Result of an explicit `POST /api/cdp/connect` (the Settings → Automation
// browser → Connect button). `connected` mirrors `/api/health`'s `cdp.connected`;
// `error` carries the reason on failure (e.g. a timed-out handshake hinting at
// an unaccepted remote-debugging prompt) so the UI can show something
// actionable instead of a bare "Not connected".
export const cdpConnectResultSchema = z
  .object({
    connected: z.boolean(),
    browser: z.string().optional(),
    port: z.number().int().positive().optional(),
    error: z.string().optional(),
  })
  .strict();

// One row in the session picker: a live PTY the user can attach to. `clients`
// is the count of currently-attached sockets (0 = dormant — alive but no one
// viewing it, the row the picker exists to surface). `state` is the
// favicon-equivalent activity (running = recent output, alive-quiet = a
// foreground program but quiet, ready = idle) so the row icon colors match the
// tab the user is looking at and gate the grace reap. `lastOutputAt` is the
// last PTY output time, exposed so the picker can sort by recency of activity.
// `clientProfiles` breaks `clients` down by the attached tabs' browser-profile
// handle (`windowId`), so the picker can show how many peers are attached and
// group them by profile — distinguishing "this profile" from "another profile."
// Optional for back-compat with a daemon that predates per-profile tracking;
// the picker falls back to a single anonymous group. The current tab matches on
// `id` against the session frame it received.
export const sessionActivityStateSchema = z.enum(["running", "alive-quiet", "ready"]);

// One profile's attached-window count within a session row. `windowId` is the
// per-browser-profile handle minted client-side and sent on the WS upgrade;
// `""` groups back-compat clients that didn't send one (allowed here so the
// server can surface them as an unknown-profile group instead of dropping
// the count). `count` is how many of that profile's windows are viewing this
// PTY right now.
export const sessionClientProfileSchema = z
  .object({
    windowId: z.string().max(MAX_WINDOW_ID_LENGTH),
    count: z.number().int().nonnegative(),
  })
  .strict();

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
    clientProfiles: z.array(sessionClientProfileSchema).optional(),
    state: sessionActivityStateSchema,
    pinned: z.boolean(),
  })
  .strict();

export const sessionsListResponseSchema = z
  .object({ sessions: z.array(sessionListItemSchema) })
  .strict();

// Programmatic PTY control surface (tmux parity). `POST /api/sessions` spawns a
// detached PTY (no browser tab); `pinned` defaults to true so an agent's shell
// survives between calls. `command` is written at spawn like the WS `?cmd=`
// param (the shell stays alive after it). `name` sets the title.
export const createSessionInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    cols: z.number().int().min(1).max(MAX_COLS).optional(),
    rows: z.number().int().min(1).max(MAX_ROWS).optional(),
    command: z.string().max(MAX_INPUT_BYTES).optional(),
    name: z.string().max(MAX_TITLE_LENGTH).optional(),
    shell: z.string().min(1).max(MAX_SHELL_PATH_LENGTH).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

export const sessionResponseSchema = z.object({ session: sessionListItemSchema }).strict();

export const updateSessionInputSchema = z
  .object({
    name: z.string().max(MAX_TITLE_LENGTH).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

export const sessionInputSchema = z
  .object({
    data: z.string().max(MAX_INPUT_BYTES),
    // When true, `data` is space-separated named keys (`F2`, `Escape`,
    // `Ctrl-C`, literal text) resolved server-side to xterm bytes — the
    // `localterm session press` path. An unknown token passes through as
    // literal text so `press hello` types "hello".
    named: z.boolean().optional(),
  })
  .strict();

export const sessionResizeSchema = z
  .object({
    cols: z.number().int().min(1).max(MAX_COLS),
    rows: z.number().int().min(1).max(MAX_ROWS),
  })
  .strict();

export const execInputSchema = z
  .object({
    command: z.string().min(1).max(MAX_INPUT_BYTES),
    timeoutMs: z.number().int().min(1).max(EXEC_MAX_TIMEOUT_MS).optional(),
    outputLimitBytes: z.number().int().min(1).max(EXEC_MAX_OUTPUT_LIMIT_BYTES).optional(),
  })
  .strict();

export const execOneShotInputSchema = z
  .object({
    command: z.string().min(1).max(MAX_INPUT_BYTES),
    cwd: z.string().min(1).optional(),
    cols: z.number().int().min(1).max(MAX_COLS).optional(),
    rows: z.number().int().min(1).max(MAX_ROWS).optional(),
    shell: z.string().min(1).max(MAX_SHELL_PATH_LENGTH).optional(),
    timeoutMs: z.number().int().min(1).max(EXEC_MAX_TIMEOUT_MS).optional(),
    outputLimitBytes: z.number().int().min(1).max(EXEC_MAX_OUTPUT_LIMIT_BYTES).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const execResultSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    output: z.string(),
    timedOut: z.boolean(),
    truncated: z.boolean(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export const capturePaneResponseSchema = z.object({ text: z.string() }).strict();

// `wait` primitive: block until the rendered pane matches a predicate or goes
// idle. `mode` discriminates the strategy. Text/regex test the flushed
// capture-renderer pane (ANSI-processed); idle resolves once no output has
// arrived for `idleMs`. Bounded by `timeoutMs` (default/ max in constants).
export const waitInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("text"),
      text: z.string().min(1).max(MAX_INPUT_BYTES),
      timeoutMs: z.number().int().min(1).max(WAIT_MAX_TIMEOUT_MS).optional(),
      caseSensitive: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("regex"),
      regex: z.string().min(1).max(MAX_INPUT_BYTES),
      timeoutMs: z.number().int().min(1).max(WAIT_MAX_TIMEOUT_MS).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("idle"),
      idleMs: z.number().int().min(50).max(5_000).optional(),
      timeoutMs: z.number().int().min(1).max(WAIT_MAX_TIMEOUT_MS).optional(),
    })
    .strict(),
]);

export const waitResultSchema = z
  .object({
    matched: z.boolean(),
    elapsedMs: z.number().int().nonnegative(),
    snapshot: z.string(),
  })
  .strict();

// `mouse` primitive: drive a TUI with the mouse. Primary path dispatches a
// real event through the tab's xterm.js (SGR generated natively); falls back to
// direct SGR-1006 bytes when no browser is reachable. `action` discriminates;
// `click` takes either explicit col/row or `onText` (resolved on the server
// grid). Coords are 0-indexed viewport cells (the SGR/CDP layer normalizes).
const mouseButtonSchema = z.enum(["left", "middle", "right"]);

export const mouseInputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("click"),
      col: z
        .number()
        .int()
        .min(0)
        .max(MAX_COLS - 1)
        .optional(),
      row: z
        .number()
        .int()
        .min(0)
        .max(MAX_ROWS - 1)
        .optional(),
      onText: z.string().min(1).max(MAX_INPUT_BYTES).optional(),
      button: mouseButtonSchema.optional(),
      clicks: z.number().int().min(1).max(3).optional(),
    })
    .strict()
    .refine((v) => (v.col !== undefined && v.row !== undefined) || v.onText !== undefined, {
      message: "click requires col+row or onText",
    }),
  z
    .object({
      action: z.literal("drag"),
      fromCol: z
        .number()
        .int()
        .min(0)
        .max(MAX_COLS - 1),
      fromRow: z
        .number()
        .int()
        .min(0)
        .max(MAX_ROWS - 1),
      toCol: z
        .number()
        .int()
        .min(0)
        .max(MAX_COLS - 1),
      toRow: z
        .number()
        .int()
        .min(0)
        .max(MAX_ROWS - 1),
      button: mouseButtonSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("move"),
      col: z
        .number()
        .int()
        .min(0)
        .max(MAX_COLS - 1),
      row: z
        .number()
        .int()
        .min(0)
        .max(MAX_ROWS - 1),
    })
    .strict(),
  z
    .object({
      action: z.literal("scroll"),
      direction: z.enum(["up", "down"]),
      amount: z.number().int().min(1).max(1000).optional(),
      col: z
        .number()
        .int()
        .min(0)
        .max(MAX_COLS - 1)
        .optional(),
      row: z
        .number()
        .int()
        .min(0)
        .max(MAX_ROWS - 1)
        .optional(),
    })
    .strict(),
]);

export const mouseResultSchema = z
  .object({
    ok: z.boolean(),
    mode: z.enum(["cdp", "sgr"]),
    col: z.number().int().nullable(),
    row: z.number().int().nullable(),
    text: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .strict();

export const mouseStateSchema = z
  .object({
    enabled: z.boolean(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  })
  .strict();

export const capturePngResponseSchema = z
  .object({ bytes: z.number().int().nonnegative() })
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

// Toggle the peer keep-awake trigger for automatic mode. When enabled (the
// default), caffeinate also stays active while any session has a second client
// attached (a phone joining via the share QR, or another tab via the session
// picker) — held for the peer's lifetime and bypassing the activity gate, so
// an idle-but-attached phone doesn't release the machine to sleep.
const caffeinatePeerKeepAwakeInputMessageSchema = z
  .object({
    type: z.literal("caffeinate-peer-keep-awake"),
    enabled: z.boolean(),
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
// `compress` is the decompressor the client advertised (feature-detected via
// `new DecompressionStream(mode)`): "br-ctx" if Brotli is supported (the best
// ratio — a persistent context-takeover stream compresses each frame against
// the prior screen, the delta), "br" as a per-frame Brotli fallback (a back-
// compat client), "gzip" as a widely-supported fallback (Chrome 80+), or null if
// the browser has no DecompressionStream (raw passthrough). null is also the
// default for a back-compat client that omits the field — it gets raw frames.
export type CompressMode = "br-ctx" | "br" | "gzip" | null;
const compressModeSchema = z.enum(["br-ctx", "br", "gzip"]).nullable();
const readyMessageSchema = z
  .object({
    type: z.literal("ready"),
    replay: z.boolean(),
    compress: compressModeSchema.default(null),
  })
  .strict();

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  inputMessageSchema,
  resizeMessageSchema,
  caffeinateModeInputMessageSchema,
  caffeinateCommandsInputMessageSchema,
  caffeinateActivityGateInputMessageSchema,
  caffeinatePeerKeepAwakeInputMessageSchema,
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
    // Current foreground process (or null at the shell prompt), snapshotted at
    // attach time. The watcher only emits foreground on change, so without
    // this a reattaching client (page refresh, silent reattach) or a fresh
    // PTY after a daemon restart would never learn the current state — the
    // icon would stay stale (stuck blue after a restart, or grey-after-green
    // on refresh). Mirrors the cwd/title snapshots already on this frame.
    foreground: z.string().max(MAX_FOREGROUND_LENGTH).nullable(),
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
    // The session that emitted the OSC 9, so a click can focus a tab on it.
    sessionId: z.string().uuid(),
    body: z.string().min(1).max(MAX_NOTIFICATION_LENGTH),
    // Whether the emitting session currently has any viewer. Drives client-side
    // suppression (don't show a notification for a session viewed in another
    // browser profile — the SW there can't focus that profile's tab) and the
    // SW's click branch (orphaned → open a fresh tab; viewed → don't duplicate).
    hasViewers: z.boolean(),
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

// Pushed by the per-cwd coordinator whenever the /api/git/branches/pr endpoint
// recomputes the PR (manual refresh or initial fetch), so a remote state change
// one tab observed — e.g. a merge on GitHub, which produces no local git-dirty
// signal — reaches every sibling tab in the same cwd. Carries no cwd field: like
// git-diff-summary, the client resets its PR lease on cwd change, so a push
// from the previous cwd (in flight when the shell `cd`'d) is wiped before it
// can stick, and the per-session socket guard drops pushes from a prior session.
const gitBranchPrMessageSchema = z
  .object({
    type: z.literal("git-branch-pr"),
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
// cleaned up). `activeSessionCount` is how many live PTYs are sitting in this
// worktree (attached, dormant in the no-clients grace window, or running an
// automation) — the same signal the delete route uses to refuse removal, so the
// client can hide the trash action on a worktree a shell is still open in
// instead of offering a delete the server would 409.
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
    activeSessionCount: z.number().int().nonnegative(),
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
const AUTOMATION_SESSION_EVENTS = [
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

// What an automation runs. A "shell" runner types an arbitrary shell command
// into a PTY tab (the original model: exit code drives the run status). An
// "agent" runner runs an agent session headlessly — fresh (ephemeral) or
// thread (resumes a persistent session file). The agent runner is orthogonal
// to the trigger, so an agent automation can fire on any schedule/watch/event/
// webhook trigger.
//
// The `harness` selects the agent implementation: the built-in `pi` harness
// drives `pi --mode rpc` (compaction controls + a transcript log), or a
// `custom` harness runs a user-supplied command (claude/codex/your own) with
// the request passed as env vars. This keeps the architecture ready to swap
// the agent without touching the rest of the automation pipeline.
const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);

const agentSessionModeSchema = z.enum(["fresh", "thread"]);

// The built-in pi harness: `extensions` (default true) toggles `--no-extensions`
// for runs whose provider extensions misbehave headless; `skills` and
// `contextFiles` do the same for `--no-skills`/`--no-context-files`.
const piHarnessSchema = z
  .object({
    kind: z.literal("pi"),
    extensions: z.boolean().default(true),
    skills: z.boolean().default(true),
    contextFiles: z.boolean().default(true),
  })
  .strict();

// A user-supplied harness: `command` runs an agent fire (the prompt + metadata
// arrive as env vars — see agent-runner.ts); `compactCommand` optionally
// compacts a thread session in place. Both run with the automation's cwd and
// resolved secrets in env. Blank `compactCommand` = compaction unsupported for
// this harness.
const customHarnessSchema = z
  .object({
    kind: z.literal("custom"),
    command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
    compactCommand: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH).optional(),
  })
  .strict();

export const agentHarnessSchema = z.discriminatedUnion("kind", [
  piHarnessSchema,
  customHarnessSchema,
]);

// A model the agent harness can run, surfaced by GET /api/agent-models (via pi's
// RPC get_available_models). The form's model selector searches these.
export const agentModelInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    contextWindow: z.number().optional(),
    reasoning: z.boolean().optional(),
  })
  .strict();

export const agentSkillInfoSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    disabled: z.boolean(),
    source: z.enum(["global-pi", "global-agents", "project-pi", "project-agents"]),
  })
  .strict();

// A flattened transcript entry from a thread-mode agent session file, surfaced
// by GET /api/automations/:id/session so the Triage log page can show the full
// session history (user / assistant / tool / compaction) instead of just the
// current run. Mirrors AgentLogEntry's shape + a purple compaction entry.
export const agentSessionEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), text: z.string() }).strict(),
  z
    .object({ type: z.literal("assistant"), text: z.string(), thinking: z.string().optional() })
    .strict(),
  z
    .object({
      type: z.literal("tool"),
      name: z.string(),
      input: z.string().max(MAX_AUTOMATION_TOOL_INPUT_LENGTH).optional(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("compaction"),
      summary: z.string(),
      tokensBefore: z.number().optional(),
    })
    .strict(),
]);

// A single structured entry in an agent run's transcript log. The UI renders a
// user/assistant/tool transcript and hides `thinking` behind a toggle. Tool
// result text is truncated by the agent runner; user/assistant text is kept
// full (bounded by the overall log byte cap).
export const agentLogEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), text: z.string().max(MAX_AUTOMATION_LOG_LENGTH) }).strict(),
  z
    .object({
      type: z.literal("assistant"),
      text: z.string().max(MAX_AUTOMATION_LOG_LENGTH),
      thinking: z.string().max(MAX_AUTOMATION_LOG_LENGTH).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool"),
      name: z.string().max(MAX_AUTOMATION_NAME_LENGTH),
      input: z.string().max(MAX_AUTOMATION_TOOL_INPUT_LENGTH).optional(),
      text: z.string().max(MAX_AUTOMATION_TOOL_RESULT_LENGTH),
    })
    .strict(),
]);

export const automationRunnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("shell"),
      command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal("agent"),
      prompt: z.string().min(1).max(MAX_AUTOMATION_PROMPT_LENGTH),
      sessionMode: agentSessionModeSchema,
      model: z.string().min(1).max(MAX_AUTOMATION_MODEL_LENGTH).optional(),
      thinking: thinkingLevelSchema.optional(),
      harness: agentHarnessSchema.default({
        kind: "pi",
        extensions: true,
        skills: true,
        contextFiles: true,
      }),
    })
    .strict(),
]);

// The wire shape equals the stored shape.
export const runnerInputSchema = automationRunnerSchema;

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
    // Agent-runner findings: the truncated final assistant text (pi harness, via
    // get_last_assistant_text) or stdout (custom harness), shown as the Triage
    // row preview + a quick detail glance. null for shell runs and agent runs
    // that produced no output. The agent runner truncates before storing; the
    // max is a defensive cap.
    findings: z.string().max(MAX_AUTOMATION_FINDINGS_LENGTH).nullable().default(null),
    // Files whose working-tree status changed across an agent run (git status
    // diff before vs after), capped. Empty for shell runs and non-repo cwds.
    changedFiles: z.array(z.string().min(1)).max(MAX_AUTOMATION_CHANGED_FILES).default([]),
    // Triage unread flag for agent runs with findings or a log; cleared when the
    // user opens the run. Always false for shell runs (no findings to triage).
    unread: z.boolean().default(false),
    // Full per-run log: a tail-bounded ANSI-stripped PTY-output string for
    // shell runs and custom-harness agent runs (stdout+stderr), or a structured
    // user/assistant/tool transcript for pi-harness agent runs (so the UI can
    // hide thinking behind a toggle). Discriminated at runtime by
    // Array.isArray (array = pi transcript). null for runs that produced no
    // output.
    log: z
      .union([
        z.string().max(MAX_AUTOMATION_LOG_LENGTH),
        z.array(agentLogEntrySchema).max(MAX_AUTOMATION_LOG_ENTRIES),
      ])
      .nullable()
      .default(null),
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

// Secret name validator, defined early: the automation stored shape below
// references it for `requestedSecrets`, so it must initialize before that shape
// is evaluated (zod reads the schema at object-literal time, so a forward
// `const` reference would hit the temporal dead zone).
const secretNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "must be alphanumeric with - or _")
  .min(1)
  .max(MAX_SECRET_NAME_LENGTH);

// Stored shape (automations.json v4). No derived fields (cron/lastRun/nextRunAt
// live only on the wire).
const automationStoredShape = {
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
  trigger: automationTriggerSchema,
  cwd: z.string().min(1),
  runner: automationRunnerSchema,
  enabled: z.boolean(),
  limit: automationRunLimitSchema,
  // When true, the run's browser tab is closed once the command finishes
  // (only honored for shell runs opened via CDP). Defaults false → tab stays
  // open. Optional in the persisted shape so pre-existing v3 files load
  // unchanged. Meaningless for agent runs (no tab) but stored as-is.
  closeOnFinish: z.boolean().default(false),
  // Names of secrets to inject as env vars when this automation's run spawns.
  // Resolved from the backend and baked into the run env (PTY for shell,
  // subprocess for agent), never returned over HTTP. Defaults to [] so
  // pre-existing v3 files load unchanged.
  requestedSecrets: z.array(secretNameSchema).max(MAX_AUTOMATION_REQUESTED_SECRETS).default([]),
  runCount: z.number().int().nonnegative(),
  lifecycle: automationLifecycleSchema,
  runs: z.array(automationRunRecordSchema).max(AUTOMATION_RUN_HISTORY_SCHEMA_MAX),
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
    runs: z.array(automationRunRecordSchema).max(AUTOMATION_RUN_HISTORY_SCHEMA_MAX),
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

// Frozen v3 file shape — read only by the v3->v4 migrator. v3 stored the
// runner as a bare top-level `command` (shell-only); v4 wraps it in a
// discriminated `runner` union. The v4 run-record schema's defaulted
// findings/changedFiles/unread fill in for v3 runs that lack them.
export const automationV3Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
    trigger: automationTriggerSchema,
    cwd: z.string().min(1),
    command: z.string().min(1).max(MAX_AUTOMATION_COMMAND_LENGTH),
    enabled: z.boolean(),
    limit: automationRunLimitSchema,
    closeOnFinish: z.boolean().default(false),
    requestedSecrets: z.array(secretNameSchema).max(MAX_AUTOMATION_REQUESTED_SECRETS).default([]),
    runCount: z.number().int().nonnegative(),
    lifecycle: automationLifecycleSchema,
    runs: z.array(automationRunRecordSchema).max(AUTOMATION_RUN_HISTORY_SCHEMA_MAX),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const automationsFileV3Schema = z
  .object({
    version: z.literal(3),
    automations: z.array(automationV3Schema),
  })
  .strict();

export const createAutomationInputSchema = z
  .object({
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH),
    trigger: triggerInputSchema,
    cwd: z.string().min(1),
    runner: runnerInputSchema,
    enabled: z.boolean().optional(),
    limit: automationRunLimitSchema.optional(),
    closeOnFinish: z.boolean().optional(),
    requestedSecrets: z.array(secretNameSchema).max(MAX_AUTOMATION_REQUESTED_SECRETS).optional(),
  })
  .strict();

export const updateAutomationInputSchema = z
  .object({
    name: z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH).optional(),
    trigger: triggerInputSchema.optional(),
    cwd: z.string().min(1).optional(),
    runner: runnerInputSchema.optional(),
    enabled: z.boolean().optional(),
    limit: automationRunLimitSchema.optional(),
    closeOnFinish: z.boolean().optional(),
    requestedSecrets: z.array(secretNameSchema).max(MAX_AUTOMATION_REQUESTED_SECRETS).optional(),
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
// in lockstep. `supported` is true on macOS (always) and Linux (where
// `systemd-inhibit` is on PATH); false elsewhere, where the coffee button is
// hidden. `active` is whether the process is running right now (drives the icon
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

// The server's chosen compress mode, sent on promote BEFORE the scrollback
// replay so the client knows how to parse the compressed replay frames. A
// back-compat server that doesn't know "br-ctx" never sends this frame, so the
// client falls back to raw (no header) — the new client + old server degrade to
// uncompressed rather than mis-parsing framed bytes as a header.
const compressMessageSchema = z
  .object({ type: z.literal("compress"), mode: compressModeSchema })
  .strict();

// A second client just attached to this PTY (a mobile ingested a desktop's
// share QR, or another tab joined via the session picker). Broadcast to the
// existing subscribers at attach time — before the joiner is added — so a
// desktop showing this session's share QR can auto-close once a mobile takes
// it over. Carries no payload: the recipients are, by construction, already
// attached to the session a peer joined.
const peerAttachedMessageSchema = z.object({ type: z.literal("peer-attached") }).strict();

// The PTY's effective size — the min cols/rows across all attached clients
// (tmux-style: a narrower peer constrains everyone). Broadcast whenever that
// min changes (a peer attaches/detaches, or any client resizes) so each
// viewer can mask the dead area beyond its own — possibly wider — grid as
// inactive chrome instead of empty terminal background. A viewer whose own
// cols/rows equal the effective size is the sole/limiting one and renders no
// mask; a lone viewer is never sent the frame at all. See
// SessionManager.recomputeResize for the broadcast gating.
const ptySizeMessageSchema = z
  .object({
    type: z.literal("pty-size"),
    cols: z.number().int().positive().max(MAX_COLS),
    rows: z.number().int().positive().max(MAX_ROWS),
  })
  .strict();

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
    peerKeepAwake: z.boolean(),
    peerActive: z.boolean(),
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
    peerKeepAwake: z.boolean(),
    batteryThreshold: z
      .number()
      .int()
      .min(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT)
      .max(CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT)
      .nullable(),
    commands: z.array(caffeinateCommandSchema).max(MAX_CAFFEINATE_COMMANDS),
  })
  .strict();

// Persisted daemon config (~/.localterm/config.json). `cdpPort`: `null`
// auto-detects (file-scan for a DevToolsActivePort), a number targets a specific
// debug endpoint via `/json/version` (e.g. Aside on 52860). `graceSeconds`: the
// no-clients grace window in seconds (`null` = never reap, `0` = reap idle
// immediately); optional in the file so an existing config without it upgrades
// to the default rather than failing the strict parse.
const cdpPortSchema = z.number().int().min(1).max(TCP_PORT_MAX).nullable();
const graceSecondsSchema = z
  .number()
  .int()
  .min(SESSION_GRACE_MIN_SECONDS)
  .max(SESSION_GRACE_MAX_SECONDS)
  .nullable();

// Identity provider config (~/.localterm/config.json `identity`). Phase 1
// Identity provider config (~/.localterm/config.json `identity`). A
// discriminated union over `provider`: `header` (a proxy-set header, the
// external-proxy escape hatch) and `passkey` (localterm is its own identity
// authority via WebAuthn). `oidc` (bring-your-own-IdP) is the next variant.
// Optional in the file so an existing config without it upgrades to the
// no-provider (single-authority) default rather than failing the parse.
const identityHeaderConfigSchema = z
  .object({
    provider: z.literal("header"),
    header: z.string().trim().min(1).max(IDENTITY_HEADER_NAME_MAX_LENGTH).optional(),
    trustedProxy: z.string().trim().min(1).max(IDENTITY_PROXY_SPEC_MAX_LENGTH).optional(),
  })
  .strict();

export const passkeyConfigSchema = z
  .object({
    provider: z.literal("passkey"),
    rpName: z.string().trim().min(1).max(IDENTITY_RP_NAME_MAX_LENGTH).optional(),
    registration: z.enum(["open", "closed"]).optional(),
    operatorToken: z.string().min(1).optional(),
  })
  .strict();

export const oidcConfigSchema = z
  .object({
    provider: z.literal("oidc"),
    issuer: z.string().url(),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1).optional(),
    claim: z.string().trim().min(1).optional(),
    scope: z.string().trim().min(1).optional(),
    operatorToken: z.string().min(1).optional(),
  })
  .strict();

export const identityConfigSchema = z.discriminatedUnion("provider", [
  identityHeaderConfigSchema,
  passkeyConfigSchema,
  oidcConfigSchema,
]);

// Unauthenticated `GET /auth/provider` response: which login flow the terminal
// app / CLI should offer. `null` = no provider (legacy single-authority mode);
// `header` = an external proxy owns the login (no in-app flow); `passkey` /
// `oidc` = localterm runs its own login. `registration` is only meaningful for
// passkey.
export const identityProviderInfoSchema = z.object({
  provider: z.enum(["header", "passkey", "oidc"]).nullable(),
  registration: z.enum(["open", "closed"]).optional(),
});

// `GET /auth/<provider>/me` response: the currently-authenticated user, or
// null when there's no session. The auth gate uses this to decide whether to
// show the terminal or the login screen.
export const authSessionSchema = z.object({
  user: z.string().nullable(),
});

// Persisted workspace manifest (~/.localterm/workspace.json): per owner + per
// browser-profile windowId, the open tabs ({cwd, shell}) so the daemon can
// reopen them via CDP on the next start. `owner` is null in single-authority
// mode; a string under an identity provider. `savedAt` bounds crash recovery
// (the manifest is the last flushed snapshot, not the exact stop-time state).
export const workspaceTabSchema = z.object({ cwd: z.string(), shell: z.string() }).strict();
export const workspaceEntrySchema = z
  .object({
    owner: z.string().nullable(),
    windowId: z.string(),
    tabs: z.array(workspaceTabSchema),
    savedAt: z.number().int(),
  })
  .strict();
export const workspaceFileSchema = z
  .object({ version: z.literal(WORKSPACE_FILE_VERSION), entries: z.array(workspaceEntrySchema) })
  .strict();

export const daemonConfigFileSchema = z
  .object({
    version: z.literal(DAEMON_CONFIG_FILE_VERSION),
    cdpPort: cdpPortSchema,
    graceSeconds: graceSecondsSchema.optional(),
    workspaceRestore: z.boolean().optional(),
    identity: identityConfigSchema.optional(),
  })
  .strict();

// API response shape for GET/PUT /api/config — always carries the resolved
// values (a number or null, never undefined). `defaultShell` is the daemon's
// detected default shell (what a spawn with no override uses) and `shells` is
// the host's `/etc/shells` list (the detected default first) so the client can
// render an informed shell picker without a second round-trip.
export const daemonConfigSchema = z
  .object({
    cdpPort: cdpPortSchema,
    graceSeconds: graceSecondsSchema,
    workspaceRestore: z.boolean(),
    defaultShell: z.string().min(1),
    shells: z.array(z.string().min(1)),
  })
  .strict();

// PUT /api/config body — either knob may be omitted when only the other is
// being changed.
export const updateDaemonConfigInputSchema = z
  .object({
    cdpPort: cdpPortSchema.optional(),
    graceSeconds: graceSecondsSchema.optional(),
    workspaceRestore: z.boolean().optional(),
  })
  .strict();

// Secret identity + the env var a shim exports it as. `name` is the secret's
// identifier and the Keychain item label (service `localterm:<name>`) and the
// join key processes/automations reference via requestedSecrets, so it is
// immutable (see constants.ts). `envVar` is the variable the shim exports and is
// editable. Values NEVER appear here — only in the backend — so the policy
// file is safe to read and lists in the UI without leaking secrets. `hasValue`
// in the API response is probed from the backend, not stored.
const secretEnvVarSchema = z
  .string()
  .trim()
  .regex(/^[A-Z_][A-Z0-9_]*$/, "must be uppercase with _")
  .min(1)
  .max(MAX_SECRET_ENV_VAR_LENGTH);
export const secretEntrySchema = z
  .object({
    name: secretNameSchema,
    envVar: secretEnvVarSchema,
  })
  .strict();
// The API response shape: an entry plus whether a value is stored in the backend.
export const secretEntryResponseSchema = z
  .object({
    name: secretNameSchema,
    envVar: secretEnvVarSchema,
    hasValue: z.boolean(),
  })
  .strict();
export const secretsListResponseSchema = z
  .object({
    supported: z.boolean(),
    shimsDir: z.string(),
    secrets: z.array(secretEntryResponseSchema).max(MAX_SECRETS),
  })
  .strict();
// PUT /api/secrets/:name body. `value` is optional so a policy-only update
// (changing envVar) doesn't require re-entering the secret.
export const secretSetInputSchema = z
  .object({
    envVar: secretEnvVarSchema,
    value: z.string().min(1).max(MAX_SECRET_VALUE_LENGTH).optional(),
  })
  .strict();
export const secretsFileSchema = z
  .object({
    version: z.literal(SECRETS_FILE_VERSION),
    secrets: z.array(secretEntrySchema).max(MAX_SECRETS),
  })
  .strict();
// age-encrypted secrets export. The plaintext the export wraps — a versioned
// {name, envVar, value} per secret — is distinct from the on-disk policy file
// (secrets.json) because it carries VALUES and travels off-machine. Validated
// on decrypt so a corrupt or foreign file fails closed instead of seeding the
// store with garbage. `value` is required (a value-less entry can't be
// re-imported; the daemon rejects a value-less create) so export skips
// policy-only rows.
export const secretExportEntrySchema = z
  .object({
    name: secretNameSchema,
    envVar: secretEnvVarSchema,
    value: z.string().min(1).max(MAX_SECRET_VALUE_LENGTH),
  })
  .strict();
export const secretExportPayloadSchema = z
  .object({
    version: z.literal(SECRET_EXPORT_VERSION),
    secrets: z.array(secretExportEntrySchema).max(MAX_SECRETS),
  })
  .strict();
// POST /api/secrets/export body. The passphrase transits the loopback body
// once (same posture as a `secret set` value) and is consumed by age; the
// response carries only the age-armored ciphertext, never plaintext values.
export const secretExportRequestSchema = z
  .object({ passphrase: z.string().min(1).max(MAX_SECRET_EXPORT_PASSPHRASE_LENGTH) })
  .strict();
export const secretExportResponseSchema = z
  .object({
    data: z.string(),
    count: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .strict();
// POST /api/secrets/import body. `data` is the age-armored ciphertext from an
// export; the daemon decrypts with the passphrase and upserts each entry
// through the same write path as PUT /api/secrets/:name. The response never
// echoes values — only counts and per-name error reasons.
export const secretImportRequestSchema = z
  .object({
    passphrase: z.string().min(1).max(MAX_SECRET_EXPORT_PASSPHRASE_LENGTH),
    data: z.string().min(1),
  })
  .strict();
export const secretImportResponseSchema = z
  .object({
    imported: z.number().int().min(0),
    created: z.number().int().min(0),
    updated: z.number().int().min(0),
    errors: z.array(z.object({ name: secretNameSchema, error: z.string() }).strict()),
  })
  .strict();
// Frozen v1 file shape — read only by the one-time migrator in
// migrate-secrets-to-processes.ts. v1 stored the binary names a secret shims
// directly on the entry (`programs`); v2 moved that wiring into processes.json
// (a process names which secrets it receives). The migrator inverts `programs`
// into processes and rewrites secrets.json without it.
const secretEntryV1Schema = z
  .object({
    name: secretNameSchema,
    envVar: secretEnvVarSchema,
    programs: z
      .array(z.string().min(1).max(MAX_PROCESS_NAME_LENGTH))
      .max(MAX_PROCESS_REQUESTED_SECRETS),
  })
  .strict();
export const secretsFileV1Schema = z
  .object({
    version: z.literal(1),
    secrets: z.array(secretEntryV1Schema).max(MAX_SECRETS),
  })
  .strict();

// A process is a binary name plus the secret names it should receive — the
// same multi-select model automations use for requestedSecrets. `name` is the
// shim filename (the binary the shim shadows), so it is immutable. The regex
// matches the old secretProgramSchema verbatim so every program name that
// validated pre-migration still validates as a process name post-migration.
export const processNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.+-]+$/, "must be a valid program name")
  .min(1)
  .max(MAX_PROCESS_NAME_LENGTH);
export const processSchema = z
  .object({
    name: processNameSchema,
    requestedSecrets: z.array(secretNameSchema).max(MAX_PROCESS_REQUESTED_SECRETS).default([]),
  })
  .strict();
export const processesFileSchema = z
  .object({
    version: z.literal(PROCESSES_FILE_VERSION),
    processes: z.array(processSchema).max(MAX_PROCESSES),
  })
  .strict();
export const processSetInputSchema = z
  .object({
    requestedSecrets: z.array(secretNameSchema).max(MAX_PROCESS_REQUESTED_SECRETS),
  })
  .strict();
export const processesListResponseSchema = z
  .object({ processes: z.array(processSchema).max(MAX_PROCESSES) })
  .strict();

// A user-imported terminal theme (JSON `{name, colors}` / bare colors, or an
// iTerm `.itermcolors` plist), normalized to `#rrggbb` by the parser. `colors` is
// a record of xterm ITheme keys to hex strings; the parser keeps only valid
// hex fields so xterm falls back to its per-field defaults for the rest. `id` is
// a stable `custom-<time>-<rand>` the daemon mints; `source` is "imported" for
// CLI/UI imports (or a user-supplied origin string).
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);

const themeColorsSchema = z.object({
  background: hexColorSchema.optional(),
  foreground: hexColorSchema.optional(),
  cursor: hexColorSchema.optional(),
  cursorAccent: hexColorSchema.optional(),
  selectionBackground: hexColorSchema.optional(),
  selectionForeground: hexColorSchema.optional(),
  selectionInactiveBackground: hexColorSchema.optional(),
  black: hexColorSchema.optional(),
  red: hexColorSchema.optional(),
  green: hexColorSchema.optional(),
  yellow: hexColorSchema.optional(),
  blue: hexColorSchema.optional(),
  magenta: hexColorSchema.optional(),
  cyan: hexColorSchema.optional(),
  white: hexColorSchema.optional(),
  brightBlack: hexColorSchema.optional(),
  brightRed: hexColorSchema.optional(),
  brightGreen: hexColorSchema.optional(),
  brightYellow: hexColorSchema.optional(),
  brightBlue: hexColorSchema.optional(),
  brightMagenta: hexColorSchema.optional(),
  brightCyan: hexColorSchema.optional(),
  brightWhite: hexColorSchema.optional(),
});

export const storedThemeSchema = z
  .object({
    id: z.string().min(1).max(MAX_THEME_ID_LENGTH),
    name: z.string().min(1).max(MAX_THEME_NAME_LENGTH),
    source: z.string().min(1).max(MAX_THEME_SOURCE_LENGTH),
    colors: themeColorsSchema,
  })
  .strict();

export const themesFileSchema = z
  .object({
    version: z.literal(THEMES_FILE_VERSION),
    activeThemeId: z.string().min(1).max(MAX_THEME_ID_LENGTH),
    customThemes: z.array(storedThemeSchema).max(MAX_CUSTOM_THEMES),
  })
  .strict();

// POST /api/themes/import body: the raw file text plus the filename (so the
// parser can derive a theme name and detect `.itermcolors`). The daemon parses
// — one parser, shared by the browser UI and the `localterm theme import` CLI.
export const importThemeInputSchema = z
  .object({
    text: z.string().min(1).max(MAX_THEME_IMPORT_TEXT_LENGTH),
    filename: z.string().min(1).max(256).optional(),
  })
  .strict();

// PUT /api/themes/active body: the id to make active (a built-in id, the
// "auto" pseudo-id, or a custom theme id). Validated against the built-ins +
// the stored custom themes at the route layer.
export const setActiveThemeInputSchema = z
  .object({ id: z.string().min(1).max(MAX_THEME_ID_LENGTH) })
  .strict();

export const themesResponseSchema = z
  .object({
    activeThemeId: z.string().min(1).max(MAX_THEME_ID_LENGTH),
    customThemes: z.array(storedThemeSchema).max(MAX_CUSTOM_THEMES),
    initialized: z.boolean(),
  })
  .strict();

export const themeResponseSchema = z.object({ theme: storedThemeSchema }).strict();

// POST /api/themes/migrate body: the browser's legacy localStorage state, pushed
// once on first contact with an uninitialized store so an upgrade preserves the
// user's imported themes + active selection (ids preserved). No-op if the store
// is already initialized (CLI or another tab wrote first).
export const migrateThemesInputSchema = z
  .object({
    activeThemeId: z.string().min(1).max(MAX_THEME_ID_LENGTH),
    customThemes: z.array(storedThemeSchema).max(MAX_CUSTOM_THEMES),
  })
  .strict();

// ----------------------------------------------------------------------------
// Terminal fonts (file format v1).
//
// The active font id + the user-entered custom family + the Nerd Font /
// ligatures toggles, stored in ~/.localterm/fonts.json so the `localterm font`
// CLI and every browser tab share one source of truth — replacing the
// per-browser localStorage the UI used to keep (the same promotion themes
// got). The browser keeps a localStorage cache for instant initial render and
// reconciles once on mount, plus a one-time migrate of the legacy cache on
// first contact with an uninitialized store.
// ----------------------------------------------------------------------------

export const fontsFileSchema = z
  .object({
    version: z.literal(FONTS_FILE_VERSION),
    activeFontId: z.string().min(1).max(MAX_FONT_ID_LENGTH),
    customFontFamily: z.string().max(MAX_CUSTOM_FONT_FAMILY_LENGTH),
    nerdFontEnabled: z.boolean(),
    ligaturesEnabled: z.boolean(),
  })
  .strict();

export const fontsResponseSchema = z
  .object({
    activeFontId: z.string().min(1).max(MAX_FONT_ID_LENGTH),
    customFontFamily: z.string().max(MAX_CUSTOM_FONT_FAMILY_LENGTH),
    nerdFontEnabled: z.boolean(),
    ligaturesEnabled: z.boolean(),
    initialized: z.boolean(),
  })
  .strict();

// PUT /api/fonts body: a partial of the font settings (the client pushes only
// the field that changed). `activeFontId` is validated against the built-ins
// (incl. "custom") at the route layer; the rest are free-form. At least one
// field is required so an empty PUT is rejected rather than a silent no-op.
export const updateFontsInputSchema = z
  .object({
    activeFontId: z.string().min(1).max(MAX_FONT_ID_LENGTH).optional(),
    customFontFamily: z.string().max(MAX_CUSTOM_FONT_FAMILY_LENGTH).optional(),
    nerdFontEnabled: z.boolean().optional(),
    ligaturesEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "empty update" });

// POST /api/fonts/migrate body: the browser's legacy localStorage font state,
// pushed once on first contact with an uninitialized store so an upgrade
// preserves the user's font selection + toggles. No-op if the store is already
// initialized (the CLI or another tab wrote first).
export const migrateFontsInputSchema = z
  .object({
    activeFontId: z.string().min(1).max(MAX_FONT_ID_LENGTH),
    customFontFamily: z.string().max(MAX_CUSTOM_FONT_FAMILY_LENGTH),
    nerdFontEnabled: z.boolean(),
    ligaturesEnabled: z.boolean(),
  })
  .strict();

// The full theme state (active id + custom library + the `initialized` flag),
// pushed to every tab on any theme mutation (import/set/delete/migrate) so open
// terminals reflect a CLI or other-tab change instantly — no polling. Mirrors
// the automations/caffeinate broadcasts; the browser's WS dispatcher applies it
// directly.
const themesMessageSchema = z
  .object({
    type: z.literal("themes"),
    activeThemeId: z.string().min(1).max(MAX_THEME_ID_LENGTH),
    customThemes: z.array(storedThemeSchema).max(MAX_CUSTOM_THEMES),
    initialized: z.boolean(),
  })
  .strict();

// The full font state (active id + custom family + toggles + the `initialized`
// flag), pushed to every tab on any font mutation (set/family/toggle/migrate)
// so open terminals reflect a CLI or other-tab change instantly — no polling.
// Mirrors the themes broadcast.
const fontsMessageSchema = z
  .object({
    type: z.literal("fonts"),
    activeFontId: z.string().min(1).max(MAX_FONT_ID_LENGTH),
    customFontFamily: z.string().max(MAX_CUSTOM_FONT_FAMILY_LENGTH),
    nerdFontEnabled: z.boolean(),
    ligaturesEnabled: z.boolean(),
    initialized: z.boolean(),
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
  gitBranchPrMessageSchema,
  automationsMessageSchema,
  caffeinateStateMessageSchema,
  themesMessageSchema,
  fontsMessageSchema,
  cdpControlledMessageSchema,
  replayEndMessageSchema,
  compressMessageSchema,
  peerAttachedMessageSchema,
  ptySizeMessageSchema,
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
