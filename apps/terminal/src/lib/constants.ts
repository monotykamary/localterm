export const RECONNECT_DELAY_MS = 1000;
export const RESIZE_DEBOUNCE_MS = 80;
export const TERMINAL_SCROLLBACK_PURGE_ERASE_DISPLAY_PARAM = 3;
export const DEFAULT_TERMINAL_FONT_SIZE_PX = 13;
export const TERMINAL_FONT_SIZE_MIN_PX = 9;
export const TERMINAL_FONT_SIZE_MAX_PX = 24;
export const TERMINAL_FONT_SIZE_STEP_PX = 1;
export const TERMINAL_TAP_MOVEMENT_THRESHOLD_PX = 10;
export const TERMINAL_KEYBOARD_HIDE_VIEWPORT_GROWTH_PX = 150;
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
export const DISCONNECT_MODAL_THRESHOLD_FAILURES = 2;
export const RESTART_COMMAND = "npx @monotykamary/localterm@latest start";
export const COPY_FEEDBACK_MS = 1500;
export const RETRY_BUTTON_FEEDBACK_MS = 800;
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
export const AUTOMATIONS_MODAL_CLOSE_TRANSITION_MS = 150;
// Most-recent runs shown in the cross-automation "Recent runs" feed.
export const RECENT_RUNS_LIMIT = 50;

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
export const GOOGLE_FONTS_STYLESHEET_ID = "localterm-google-fonts";
export const NERD_FONT_ENABLED_STORAGE_KEY = "localterm:nerd-font-enabled";
export const LIGATURES_ENABLED_STORAGE_KEY = "localterm:ligatures-enabled";
export const FONT_LOAD_PROBE_PX = 16;

// Initial byte capacity of the OutputBatcher staging buffer. Picked above the
// largest single TUI repaint (~6KB on a 120×40 terminal) so the buffer doesn't
// need to grow on the first frame of an ASCII animation; subsequent bursts
// double-capacity on demand until they fit into the reused backing store.
export const OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES = 8 * 1024;

// Visible-output flush threshold. Output at or below this size is flushed
// synchronously in the WebSocket message handler (calling terminal.write
// immediately) instead of being deferred to a requestAnimationFrame. A terminal
// query a probing program emits (DA1/DSR/OSC/DECRQM from a shell prompt
// plugin or a TUI resuming after a foreground program exits) must be parsed by
// xterm.js and answered in the SAME task — otherwise the rAF deferral (~16ms
// when visible, the dominant latency after the server's 2ms coalescing window)
// pushes xterm's response past the probe's short read timeout, and the
// response then sits in the PTY stdin and is read as typed garbage (e.g.
// `62;4;9;22c` after closing a TUI switched to via the session picker).
// xterm parses a write under this threshold within its 12ms synchronous
// budget, so a sync flush answers the query with sub-frame latency. Large
// buffers (sustained renders, `cat` of large files) exceed the threshold and
// keep the rAF coalescing for throughput — the high-throughput path is
// unchanged. The threshold covers interactive output (queries <1KB, TUI
// redraws 3–6KB on a 120×40 terminal) while staying well under xterm's 12ms
// parse budget, so sync flushing never spills to xterm's own async drain.
export const OUTPUT_SYNC_FLUSH_MAX_BYTES = 8 * 1024;

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
