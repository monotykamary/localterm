export const RECONNECT_DELAY_MS = 1000;
export const RESIZE_DEBOUNCE_MS = 80;
// Collapsed tool-output preview (lines) in the agent log, matching pi core's
// bash preview. A tool with more lines collapses to this + offers an expand.
export const TOOL_OUTPUT_PREVIEW_LINES = 5;
export const TERMINAL_SCROLLBACK_PURGE_ERASE_DISPLAY_PARAM = 3;
export const DEFAULT_TERMINAL_FONT_SIZE_PX = 13;
export const TERMINAL_FONT_SIZE_MIN_PX = 9;
export const TERMINAL_FONT_SIZE_MAX_PX = 24;
export const TERMINAL_FONT_SIZE_STEP_PX = 1;
export const TERMINAL_TAP_MOVEMENT_THRESHOLD_PX = 10;
export const TERMINAL_KEYBOARD_VIEWPORT_HEIGHT_CHANGE_PX = 150;
export const TERMINAL_VIEWPORT_WIDTH_STABLE_PX = 20;
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.2;
// xterm.js refuses lineHeight < 1 (throws "lineHeight cannot be less than 1").
export const TERMINAL_LINE_HEIGHT_MIN = 1.0;
export const TERMINAL_LINE_HEIGHT_MAX = 2.0;
export const TERMINAL_LINE_HEIGHT_STEP = 0.1;
export const DEFAULT_TERMINAL_PADDING_X_PX = 0;
export const DEFAULT_TERMINAL_PADDING_Y_PX = 0;
export const TERMINAL_PADDING_MIN_PX = 0;
export const TERMINAL_PADDING_MAX_PX = 48;
export const TERMINAL_PADDING_STEP_PX = 1;
export const DEFAULT_TERMINAL_CURSOR_BLINK = true;
export const DEFAULT_TERMINAL_LOCAL_ECHO = true;
export const DEFAULT_TERMINAL_SCROLL_ON_USER_INPUT = true;
export const FALLBACK_TERMINAL_BACKGROUND_HEX = "#101010";
export const DEFAULT_DOCUMENT_TITLE = "localterm";
export const DEAD_SESSION_TITLE_PREFIX = "† ";
// Title and per-session tag for desktop notifications shown via the service
// worker. The tag is per-session so fan-out deliveries across the user's tabs
// coalesce into one OS notification, while different sessions each keep a slot.
export const NOTIFICATION_TITLE = "localterm";
export const NOTIFICATION_TAG_PREFIX = "localterm:";
export const DISCONNECT_MODAL_THRESHOLD_FAILURES = 2;
export const RESTART_COMMAND = "npx @monotykamary/localterm@latest start";
export const COPY_FEEDBACK_MS = 1500;
export const RETRY_BUTTON_FEEDBACK_MS = 800;
// A pasted/shared image upload can take a few seconds on a slow mobile link;
// keep the "pasting image…" / outcome toast up briefly once it settles.
export const PASTED_IMAGE_FEEDBACK_MS = 1800;
// Stable id for the pasted-image status toast so a follow-up (done/error) upserts
// the in-flight "Pasting image…" toast in place instead of stacking a new one.
export const PASTED_IMAGE_TOAST_ID = "pasted-image";
export const HAPTIC_TAP_MS = 10;
export const RECONNECT_FAST_POLL_INTERVAL_MS = 250;
export const RECONNECT_FAST_POLL_DURATION_MS = 5000;
export const RECONNECT_POLL_INTERVAL_MS = 5000;
export const FAVICON_RUNNING_DEBOUNCE_MS = 250;
// How long a merged PR stays surfaced in the toolbar indicator and diff-viewer
// branch-mode auto-open. Past this, the PR is considered stale noise (e.g. a
// main→production reverse-merge lingering on main) and the overlay hides it.
export const MERGED_PR_OVERLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Branches where a stale merged PR is noise (a merged PR lingering on the base
// branch — e.g. a main→production reverse-merge — stops surfacing after the
// TTL above). Feature branches keep their merged PR indicator indefinitely.
export const BASE_BRANCHES = ["main", "master", "dev", "develop", "staging", "production"] as const;
export const FAVICON_READY_DEBOUNCE_MS = 750;
export const FAVICON_DEAD_OPACITY = 0.35;

export const COMMAND_PALETTE_CLOSE_TRANSITION_MS = 150;
// Shared max height for the top-anchored palette-style overlays (command
// palette + sessions modal) so the two open at the same height and don't jump
// when one replaces the other. 400px mirrors the original command-palette cap
// (a handful of grouped commands + a footer); the sessions modal virtualizes
// its list so many shells scroll inside the same box.
export const PALETTE_MODAL_MAX_HEIGHT_PX = 400;
// Settings modal: taller than the palette modals (it holds many sections) but
// capped by viewport so a phone never overflows past the bottom; the body
// scrolls inside. min() picks the smaller of the fixed cap and the vh cap.
export const SETTINGS_MODAL_MAX_HEIGHT_CSS = "min(620px, calc(100dvh - 20vh))";
export const SETTINGS_MODAL_CLOSE_TRANSITION_MS = 150;
export const CDP_PORT_MAX = 65_535;
// UI bounds for Settings → Sessions → Grace period (seconds). Mirror the
// server's ~/.localterm/config.json grace schema; the server remains the source
// of truth for validation. `null` (empty field) = never reap.
export const SESSION_GRACE_MIN_SECONDS = 0;
export const SESSION_GRACE_MAX_SECONDS = 3_600;

export const DIFF_VIEWER_CLOSE_TRANSITION_MS = 150;
// Delay before reacting to a server git-dirty signal in the open diff viewer.
// The server already throttles git-dirty at 100ms; this coalesces rapid edits
// so we don't thrash the UI while still updating in near-realtime.
export const DIFF_VIEWER_REALTIME_REFRESH_DEBOUNCE_MS = 500;
// Lines rendered on a file's first paint in the diff viewer. The rest stream in
// progressively (DIFF_VIEWER_RENDER_CHUNK lines per animation frame) so a
// generated-file diff paints its first screen instantly without locking up the
// main thread.
export const DIFF_VIEWER_INITIAL_LINE_LIMIT = 2000;
// Lines revealed per frame as the diff renders progressively after first paint.
export const DIFF_VIEWER_RENDER_CHUNK = 2000;
export const SIDEBAR_COLLAPSE_WIDTH_PX = 768;
export const DIFF_VIEWER_SIDEBAR_WIDTH_PX = 288;
export const AUTOMATIONS_SIDEBAR_COLLAPSE_WIDTH_PX = 768;
export const AUTOMATIONS_SIDEBAR_WIDTH_PX = 256;
export const DIFF_VIEW_MODE_STORAGE_KEY = "localterm:diff-view-mode";
export const PATCH_PREFETCH_CONCURRENCY = 3;
export const PATCH_PREFETCH_NEIGHBOR_RADIUS = 5;

export const AUTOMATIONS_SORT_STORAGE_KEY = "localterm:automations-sort";
export const AUTOMATIONS_SORT_DEFAULT = "last-run" as const;
export const AUTOMATIONS_RELATIVE_TIME_REFRESH_MS = 30_000;
// While the modal is open, re-fetch automations on this cadence so a run that
// finishes flips to its final status even if the WS broadcast was missed (a
// dropped/reconnecting socket left a completed run showing "running…").
export const AUTOMATIONS_LIVE_POLL_MS = 4_000;
export const AUTOMATIONS_MODAL_CLOSE_TRANSITION_MS = 150;
// Tolerance for treating the run-log scroll container as pinned to the bottom,
// so subpixel rounding doesn't flicker the "scroll to bottom" button.
export const RUN_LOG_AT_BOTTOM_THRESHOLD_PX = 4;
// Most-recent runs shown in the cross-automation "Recent runs" feed.
export const RECENT_RUNS_LIMIT = 50;
// Triage inbox threading: same-automation runs collapse into one thread once the
// visible set reaches this many runs; below it they stay as plain inline rows.
export const TRIAGE_THREAD_MIN_RUNS = 2;
// Rolling window (in days) backing the "This week" date band in the triage log.
export const TRIAGE_WEEK_BAND_DAYS = 7;

export const WORKTREES_MODAL_CLOSE_TRANSITION_MS = 150;
export const WORKTREES_LIST_ROW_HEIGHT_PX = 56;
// Min height for the error block (stacked Alert + message + Retry button needs
// ~84px of vertical room). Preserves the original min-h-32 (8rem) comfort.
export const WORKTREES_MESSAGE_BLOCK_MIN_HEIGHT_PX = 128;
export const WORKTREES_MODAL_MAX_HEIGHT_REM = 40;
// Polled while the worktrees modal is open so the per-worktree "in use" count
// (and thus the trash action) reflects shells opened or closed — including one
// opened from the modal's own "open in new shell" button. The count is the same
// signal the delete route guards on, so the list stays consistent with the
// guard without the client re-deriving it.
export const WORKTREES_POLL_INTERVAL_MS = 2000;

export const SESSIONS_MODAL_CLOSE_TRANSITION_MS = 150;
// Each session row is a single-line command-palette-style option (icon + title
// + right detail), matching COMMAND_ITEM_CLASSES' py-2 text-sm height.
export const SESSIONS_LIST_ROW_HEIGHT_PX = 36;
// Polled while the sessions modal is open so the list reflects attaches,
// detaches, and grace reaps in near-realtime. Short enough to feel live, long
// enough to avoid hammering the daemon on an idle open.
export const SESSIONS_POLL_INTERVAL_MS = 1500;
// Min height reserved for the sessions modal's error/empty block (a centered
// message + Retry button, or a two-line empty hint) so the palette modal body
// doesn't collapse while the message is on screen — mirrors the worktrees and
// ports modals' message-block reservation, and gives the height transition a
// stable floor to grow from on the way to a populated list.
export const SESSIONS_MESSAGE_BLOCK_MIN_HEIGHT_PX = 112;
// Max peer dots rendered in a session picker row before the rest collapse into
// a "+N" overflow. Most sessions have a handful of attached clients, so this
// caps the cluster's width; the count is still exact via the overflow suffix.
export const SESSIONS_MAX_PEER_DOTS = 5;
// Edge length (px) of a peer avatar face in a session picker row. Big enough
// to read each profile's distinct face, small enough to fit the 36px row
// (py-2 leaves 20px of content) and keep a 5-face cluster's width modest.
export const SESSIONS_PEER_FACE_SIZE_PX = 16;
// Curated palette a profile's peer faces draw their background from
// (peerProfileColor hashes the windowId into this). Distinct hues around the
// wheel so each browser profile reads as a different color. Nine entries so
// two profiles rarely share a color.
export const SESSIONS_PEER_FACE_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
];
// Face-feature ink — facehash draws its eyes + first-letter mouth in
// `currentColor` (this). Black so the features read dark on the colored bg, not
// the inherited foreground (white) of the picker row. Also drives the
// self-ring (ring-black) so the "me" outline matches the features.
export const SESSIONS_PEER_FACE_INK_HEX = "#000000";
// Corner radius of the peer-face squircle (a continuous-corner rounded square),
// as a percentage of the face size so it scales. Less than 50% (a circle) so
// the avatar reads as a squircle, not a dot.
export const SESSIONS_PEER_FACE_RADIUS_PCT = "30%";

// Open dev ports modal: mirrors the sessions modal's palette-style overlay and
// close timing. Each poll runs `ps` + `lsof` on the daemon (heavier than the
// sessions list's single read), so the interval is a touch longer to stay light
// on an idle open while still surfacing a dev server starting/stopping live.
export const PORTS_MODAL_CLOSE_TRANSITION_MS = 150;
export const PORTS_POLL_INTERVAL_MS = 2000;
// Each port row matches the sessions/command-palette single-line option
// (py-2 text-sm = 36px), so the modal reuses the same per-row height to size
// its height-reserved list container (no per-row measurement needed — a row's
// title truncates to one line, so the height is stable).
export const PORTS_LIST_ROW_HEIGHT_PX = SESSIONS_LIST_ROW_HEIGHT_PX;
// Min height reserved for the ports modal's error/empty block (a centered
// message + Retry button, or a two-line empty hint) so the palette modal body
// doesn't collapse to zero while the message is on screen — mirrors the
// worktrees modal's message-block reservation.
export const PORTS_MESSAGE_BLOCK_MIN_HEIGHT_PX = 112;

// QR session-transfer modal: Share renders a QR of this tab's session URL for
// another device to scan; Ingest scans another device's QR and switches this
// tab to its session. Mirrors the other palette-style overlays' close timing.
export const QR_MODAL_CLOSE_TRANSITION_MS = 150;
// Edge length (px) of the rendered share-QR canvas — large enough to scan from
// a phone, small enough to fit the modal.
export const QR_CODE_SIZE_PX = 200;
// Per-program secret injection manager. Close-transition mirrors the other
// palette-style overlays; max height keeps the list scrollable on a phone.
export const SECRETS_MODAL_CLOSE_TRANSITION_MS = 150;
export const SECRETS_MODAL_MAX_HEIGHT_PX = 520;
// Min height reserved for the secrets modal body while the list loads and for
// the error block, so the panel opens at a stable size and the height
// transition has a floor to grow from — mirrors the ports/sessions/worktrees
// modals' message-block reservation.
export const SECRETS_BODY_MIN_HEIGHT_PX = 112;
// Estimated height of a secret row (icon + name + env var); the virtualizer
// corrects each row to its measured height, so this only sizes the first paint
// before measurement.
export const SECRETS_LIST_ROW_HEIGHT_PX = 44;
// Quiet-zone margin (QR modules) around the share QR so cameras lock on
// without edge bleed.
export const QR_CODE_MARGIN_MODULES = 2;
// jsQR only runs this often against a captured frame, so the ingest loop stays
// light instead of pegging a core at the display refresh rate.
export const QR_SCAN_DECODE_INTERVAL_MS = 80;
// Longest edge (px) handed to jsQR — camera frames downscale to this before
// decoding so a 1080p stream isn't a multi-megapixel pass every frame.
export const QR_SCAN_DECODE_MAX_EDGE_PX = 480;

export const TOOLBAR_HIDE_DELAY_MS = 200;
export const TOOLBAR_VIEWPORT_EDGE_HIDE_DELAY_MS = 1500;
export const TOOLTIP_DELAY_MS = 300;
export const TOOLTIP_SIDE_OFFSET_PX = 8;

export const NUMBER_STEPPER_SCRUB_PIXELS_PER_STEP = 5;

export const ENTER_KEY_CODE = 13;
export const TERMINAL_ESCAPE_SEQUENCE = String.fromCharCode(27);
export const TERMINAL_TAB_SEQUENCE = "\t";
export const TERMINAL_BACK_TAB_SEQUENCE = TERMINAL_ESCAPE_SEQUENCE + "[Z";
export const TERMINAL_BACKSPACE_SEQUENCE = String.fromCharCode(127);
export const TERMINAL_CARRIAGE_RETURN_SEQUENCE = String.fromCharCode(ENTER_KEY_CODE);
export const TERMINAL_CURSOR_WORD_LEFT_SEQUENCE = TERMINAL_ESCAPE_SEQUENCE + "b";
export const TERMINAL_CURSOR_WORD_RIGHT_SEQUENCE = TERMINAL_ESCAPE_SEQUENCE + "f";
export const TERMINAL_CURSOR_LINE_START_SEQUENCE = String.fromCharCode(1);
export const TERMINAL_CURSOR_LINE_END_SEQUENCE = String.fromCharCode(5);
export const TERMINAL_DELETE_TO_LINE_START_SEQUENCE = String.fromCharCode(21);
export const KEYBOARD_MODIFIER_SHIFT_BIT = 1;
export const KEYBOARD_MODIFIER_ALT_BIT = 2;
export const KEYBOARD_MODIFIER_CTRL_BIT = 4;
export const KEYBOARD_MODIFIER_META_BIT = 8;
// Kitty keyboard protocol "Disambiguate escape codes" flag (bit 0). Active means
// modifier+key combos must be reported as `CSI <keycode>;<mods+1> u` instead of
// the legacy bare control byte (which can't distinguish e.g. Enter vs Shift+Enter).
export const KITTY_KEYBOARD_DISAMBIGUATE_FLAG = 1;
export const KITTY_KEYBOARD_SET_MODE_REPLACE = 1;
export const KITTY_KEYBOARD_SET_MODE_OR = 2;
export const KITTY_KEYBOARD_SET_MODE_AND_NOT = 3;

export const SEARCH_MATCH_BACKGROUND_HEX = "#ffc79944";
export const SEARCH_ACTIVE_MATCH_BACKGROUND_HEX = "#ffc799";
export const SEARCH_ACTIVE_MATCH_BORDER_HEX = "#ff8080";

// Coffee button (keep-awake toggle). The icon tints to a warm coffee tone when
// active; otherwise it renders like the other toolbar icons.
export const CAFFEINATE_ACCENT_COLOR = "#c8956c";

export const TERMINAL_THEME_STORAGE_KEY = "localterm:terminal-theme-id";
export const TERMINAL_FONT_STORAGE_KEY = "localterm:terminal-font-id";
export const TERMINAL_FONT_SIZE_STORAGE_KEY = "localterm:terminal-font-size";
export const TERMINAL_LINE_HEIGHT_STORAGE_KEY = "localterm:terminal-line-height";
export const TERMINAL_CURSOR_STYLE_STORAGE_KEY = "localterm:terminal-cursor-style";
export const TERMINAL_CURSOR_BLINK_STORAGE_KEY = "localterm:terminal-cursor-blink";
export const TERMINAL_LOCAL_ECHO_STORAGE_KEY = "localterm:terminal-local-echo";
// Client-side predictive echo ("local echo") for high-latency links. A
// measured round-trip time gates prediction on only when latency exceeds the
// threshold, so a fast local surface never gets a per-keystroke dim flash. The
// first keystroke of an idle burst probes the RTT when the estimate is unknown
// or stale; later keystrokes predict only if the link is slow.
export const LOCAL_ECHO_THRESHOLD_MS = 50;
export const LOCAL_ECHO_BURST_IDLE_MS = 400;
export const LOCAL_ECHO_RTT_STALE_MS = 10_000;
export const LOCAL_ECHO_RTT_EMA_ALPHA = 0.3;
export const LOCAL_ECHO_PENDING_MAX_CHARS = 64;
// Watchdog for a misdetected no-echo prompt (e.g. a password read that slipped
// past the foreground/buffer gate): unconfirmed predictions erase after this
// window so typed text can never persist as visible dim output, and
// prediction then cools down to let the real prompt state resettle.
export const LOCAL_ECHO_TIMEOUT_MS = 1_000;
export const LOCAL_ECHO_COOLDOWN_MS = 5_000;
export const TERMINAL_SCROLLBACK_STORAGE_KEY = "localterm:terminal-scrollback";
export const TERMINAL_SCROLL_ON_USER_INPUT_STORAGE_KEY = "localterm:terminal-scroll-on-user-input";
export const TERMINAL_PADDING_X_STORAGE_KEY = "localterm:terminal-padding-x";
export const TERMINAL_PADDING_Y_STORAGE_KEY = "localterm:terminal-padding-y";
// Default working directory for shells launched without an explicit ?cwd=
// (PWA app-icon launch, a fresh tab before any session connects, a reloaded
// bare URL). Empty = unset, so the server falls back to the home directory.
export const DEFAULT_CWD_STORAGE_KEY = "localterm:default-cwd";
// Saved default shell override sent on the WS upgrade as `?shell=` (the
// per-tab mirror of the CLI `--shell` flag). Empty = unset, so the server uses
// its detected login shell (surfaced as the Settings field's placeholder).
export const DEFAULT_SHELL_STORAGE_KEY = "localterm:default-shell";
// Whether a touch-device (phone/tablet) bare connect resumes the user's most
// recently active shell instead of spawning a fresh one. Default on; opt-out
// from Settings → Launch restores the original spawn-fresh behavior.
export const MOBILE_RESUME_STORAGE_KEY = "localterm:mobile-resume";
// The per-browser-profile handle minted on first load and sent on the WS
// upgrade as `?wid=`. `localStorage` is partitioned per browser profile, so
// every tab/window of one profile shares this id and a different profile gets
// a different one — letting the session picker group a row's attached clients
// by profile. A uuid minted on first miss; never cleared (stable across
// restarts). Incognito's ephemeral storage mints a fresh id each session.
export const WINDOW_ID_STORAGE_KEY = "localterm:window-id";
// User-entered custom font family (a system-installed Nerd Font such as
// "JetBrainsMono Nerd Font Mono") used only when the font id is "custom".
// Empty = the custom font falls back to the bundled default family.
export const CUSTOM_FONT_FAMILY_STORAGE_KEY = "localterm:custom-font-family";
// User-imported terminal themes (JSON shape + iTerm .itermcolors), stored as
// a JSON array of TerminalTheme so the Theme picker can list them alongside
// the built-ins and a delete can splice by id.
export const CUSTOM_THEMES_STORAGE_KEY = "localterm:custom-themes";
export const NERD_FONT_ENABLED_STORAGE_KEY = "localterm:nerd-font-enabled";
export const LIGATURES_ENABLED_STORAGE_KEY = "localterm:ligatures-enabled";
export const FONT_LOAD_PROBE_PX = 16;

// Initial byte capacity of the OutputBatcher staging buffer. Picked above the
// largest single TUI repaint (~6KB on a 120×40 terminal) so the buffer doesn't
// need to grow on the first frame of an ASCII animation; subsequent bursts
// double-capacity on demand until they fit into the reused backing store.
export const OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES = 8 * 1024;
export const SYNCHRONIZED_OUTPUT_END_SEQUENCE = "\x1b[?2026l";

// A response immediately following PTY input can consume xterm's pending WebGL
// render in the parser callback instead of waiting for its render rAF. Keep the
// fast path to normal interactive redraw sizes so a key pressed during a
// firehose cannot turn a 64KB throughput batch into synchronous render work.
export const INTERACTIVE_OUTPUT_RENDER_MAX_BYTES = 8 * 1024;
// Causal window between a successfully-sent PTY input and its response. Long
// enough for a relayed connection, bounded so unrelated autonomous output does
// not inherit a stale input's immediate-render treatment.
export const INTERACTIVE_OUTPUT_RENDER_WINDOW_MS = 500;

// Raw in/out: the client flushes every ordinary output write synchronously on
// arrival (one terminal.write per WebSocket message, in the WS message task —
// a macrotask, not a requestAnimationFrame). The server coalesces ordinary TUI
// bursts and caps each message at OUTPUT_BATCH_FLUSH_BYTES (under xterm's 12ms
// parse-yield budget, so a single write never spills to xterm's async drain).
// Large DEC 2026 frames can span messages; the client preserves those message
// boundaries but holds the following frame until xterm presents the completed
// one. This gives each frame the earliest safe render rAF, keeps
// xterm's parse out of a vsync so it can't starve the render rAF (the
// "smooth fps but visual stutter" same-deadline clash the old rAF coalescer had),
// and lets xterm answer a terminal query in the same task before the probing
// program's read times out (the response otherwise leaks into the shell as
// typed garbage, e.g. `62;4;9;22c` after closing a TUI switched to via the
// session picker). A no-op keep-warm rAF (see write-terminal-output.ts) keeps
// the compositor's frame loop warm across animation-frame gaps without
// carrying any parse work.

// Grace window after the last output chunk during which OutputBatcher holds a
// self-requeuing requestAnimationFrame. Without an outstanding rAF, Chrome's
// compositor flips `needsBeginFrame` to false the moment the main thread has no
// pending work — which happens on the natural multi-tens-of-ms gaps between
// ASCII-animation frames. The tab then hibernates its frame loop until the next
// output chunk arrives (~100ms later), then renders the whole backlog in one
// frame: the visible "stall then catch-up burst" jank. A no-op vsync commit
// for this window keeps the frame loop warm (adaptive — lapses to idle/rest
// after the window, so a static terminal uses zero extra frames) and lets each
// animation frame paint in its own frame. Picked above the largest expected
// inter-frame gap of common animators (cmatrix ~100ms, sl ~50ms) so streaming
// output keeps continuous cadence while a genuinely idle terminal rests.
export const OUTPUT_KEEP_WARM_MS = 150;

// Server->client output compression frame-header bytes (see the server's
// WS_OUTPUT_* constants). The server prepends a header to each compressed
// binary output frame: 0x00 = raw, 0x01 = gzip, 0x02 = brotli (per-frame, all
// 1-byte headers), 0x03 = brotli context-takeover (a 5-byte header: 0x03 + 4-byte
// LE raw size, so the client can size-delimit a frame out of the persistent
// DecompressionStream that doesn't end per frame).
export const WS_OUTPUT_RAW = 0x00;
export const WS_OUTPUT_GZIP = 0x01;
export const WS_OUTPUT_BROTLI = 0x02;
export const WS_OUTPUT_BROTLI_CTX = 0x03;
export const WS_OUTPUT_CTX_HEADER_BYTES = 5;

// How often the terminal polls the daemon's cached update check (the daemon
// refreshes it once per UPDATE_CHECK_INTERVAL_MS on its own; this cadence just
// picks up a refreshed cache, so it stays lax). A poll returns the
// non-blocking cache and triggers a background refresh only when stale.
export const UPDATE_STATUS_POLL_INTERVAL_MS = 30 * 60 * 1000;
// How long the update banner's copy button shows its “copied” feedback.
export const UPDATE_COPY_FEEDBACK_MS = 1500;

// On-screen keyboard (Unexpected-Keyboard-style in-app keyboard for touch).
// The 100% baseline follows Apple iOS keyboard metrics in CSS px; the compact
// default scales every visual metric together and users can resize it in the
// keyboard settings panel without changing the terminal's column count.
export const DEFAULT_KEYBOARD_HEIGHT_SCALE_PERCENT = 85;
export const KEYBOARD_HEIGHT_SCALE_MIN_PERCENT = 70;
export const KEYBOARD_HEIGHT_SCALE_MAX_PERCENT = 120;
export const KEYBOARD_HEIGHT_SCALE_STEP_PERCENT = 5;
export const KEYBOARD_HEIGHT_SCALE_BASE_PERCENT = 100;
export const DEFAULT_KEYBOARD_HAPTICS_ENABLED = true;
export const DEFAULT_KEYBOARD_KEY_PREVIEW_ENABLED = true;
export const DEFAULT_KEYBOARD_KEY_REPEAT_ENABLED = true;
export const KEYBOARD_HEIGHT_SCALE_STORAGE_KEY = "localterm:keyboard-height-scale";
export const KEYBOARD_HAPTICS_STORAGE_KEY = "localterm:keyboard-haptics";
export const KEYBOARD_KEY_PREVIEW_STORAGE_KEY = "localterm:keyboard-key-preview";
export const KEYBOARD_KEY_REPEAT_STORAGE_KEY = "localterm:keyboard-key-repeat";
export const KEYBOARD_KEY_HEIGHT_PX = 42;
export const KEYBOARD_BOTTOM_KEY_HEIGHT_PX = 44;
export const KEYBOARD_GAP_PX = 6;
export const KEYBOARD_ROW_GAP_PX = 6;
export const KEYBOARD_HORIZONTAL_PADDING_PX = 4;
export const KEYBOARD_BOTTOM_PADDING_PX = 4;
export const KEYBOARD_KEY_RADIUS_PX = 5;
export const KEYBOARD_FONT_SIZE_PX = 22;
export const KEYBOARD_TABLET_FONT_SIZE_ADDITION_PX = 2;
export const KEYBOARD_ALTERNATE_FONT_SIZE_PX = 11;
export const KEYBOARD_ALTERNATE_ICON_SIZE_PX = 14;
export const KEYBOARD_SPECIAL_FONT_SIZE_PX = 15;
export const KEYBOARD_ICON_SIZE_PX = 20;
// Slide distance from the press point before a corner alternate is selected.
// Below it the center char stays (filters jitter and grazing touches, the iOS
// touch slop); past it a defined alternate wins only near its corner angle.
export const KEYBOARD_SLIDE_THRESHOLD_PX = 18;
export const KEYBOARD_SLIDE_DIRECTION_TOLERANCE_RAD = Math.PI / 6;
// Press-and-hold auto-repeats the key (hardware key-repeat feel), so holding an
// arrow corner moves the cursor continuously. Initial delay then a steady
// interval, tuned for smooth arrow movement.
export const KEYBOARD_KEY_REPEAT_INITIAL_DELAY_MS = 350;
export const KEYBOARD_KEY_REPEAT_INTERVAL_MS = 60;
// Press popup (the magnified key preview shown while a key is held). Width is
// sized to fit the label so multi-char popups like "delete" or "caps lock"
// don't clip; the char-width factor is a generous sans estimate for clamping.
export const KEYBOARD_CALLOUT_FONT_SIZE_PX = 28;
export const KEYBOARD_CALLOUT_CHAR_WIDTH_FACTOR = 0.6;
export const KEYBOARD_CALLOUT_PADDING_PX = 24;
export const KEYBOARD_CALLOUT_OFFSET_PX = 6;
// Holding shift past this delay engages caps lock (stays on until tapped off);
// a quick tap just toggles shift on/off.
export const KEYBOARD_SHIFT_LONG_PRESS_MS = 400;
// A touch-primary device with no fine pointer or hover is a phone or tablet;
// anything else (desktop, laptop, touch-laptop, iPad+trackpad) is desktop-class
// and never renders the on-screen keyboard. iPadOS 13+ ships a Mac UA, so UA
// sniffing can't tell an iPad from a Mac — matchMedia reflects real capability.
export const DEVICE_TABLET_MIN_WIDTH_PX = 768;
