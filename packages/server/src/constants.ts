export const DEFAULT_PORT = 3417;
export const DEFAULT_HOST = "127.0.0.1";
export const FRIENDLY_HOSTNAME = "localterm.localhost";
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 32;
export const DEFAULT_SHELL_FALLBACK = "/bin/sh";

export const TERM_TYPE = "xterm-256color";
export const COLORTERM_VALUE = "truecolor";
export const LOCALTERM_VALUE = "1";

// Base PATH for user shells (PTYs, "Open in…"). They set up their own PATH via
// rc files like any login shell, so they must not inherit the daemon's baked
// PATH: a launchd daemon has no GUI provenance, so the homebrew binaries mise/
// direnv bootstrap from the leaked PATH get re-assessed by syspolicyd per prompt.
export const PTY_BASE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

// Keep-awake on macOS. `-d` display, `-i` idle, `-m` disk, `-s` system sleep —
// held for as long as the spawned process lives (a single process, so a plain
// child.kill() releases it).
export const CAFFEINATE_BINARY = "caffeinate";
export const CAFFEINATE_ARGS: readonly string[] = ["-dims"];
// Keep-awake on Linux. `systemd-inhibit` holds a logind inhibitor for the
// lifetime of the process it runs; `tail -f /dev/null` is the portable
// forever-blocker (present in both coreutils and busybox; `sleep infinity` is
// GNU-coreutils-only). `--what` maps the macOS flags: `idle` ≈ `-d`/`-i`
// (block idle sleep + display), `sleep` ≈ `-s` (block system suspend),
// `handle-lid-switch` blocks lid-close suspend on laptops. `--mode=block`
// makes the lock operational (vs `delay`, which only defers briefly). Spawned
// detached so systemd-inhibit becomes a session/group leader: killing the
// whole process group releases the inhibitor AND reaps the orphaned tail —
// a plain child.kill() of just systemd-inhibit would release the lock (it's
// tied to the registrar's D-Bus lifetime) but leave tail reparented to init.
export const SYSTEMD_INHIBIT_BINARY = "systemd-inhibit";
export const SYSTEMD_INHIBIT_ARGS: readonly string[] = [
  "--what=idle:sleep:handle-lid-switch",
  "--mode=block",
  "tail",
  "-f",
  "/dev/null",
];

// Keep-awake "automatic" mode recognizes these commands out of the box and
// caffeinates whenever one is running in any localterm session. Fixed — the
// user can add their own on top but cannot remove these.
export const CAFFEINATE_AUTO_DEFAULT_COMMANDS: readonly string[] = [
  "claude",
  "codex",
  "opencode",
  "pi",
];
export const CAFFEINATE_PREFERENCES_FILE_VERSION = 4;
export const DAEMON_CONFIG_FILE_VERSION = 1;
// Persisted workspace manifest (~/.localterm/workspace.json): per owner +
// per browser-profile windowId, the list of open tabs ({cwd, shell}) so the
// daemon can reopen them via CDP on the next start. Excludes automation-run
// tabs (one-shot) and dormant/orphaned shells (no attached viewer).
export const WORKSPACE_FILENAME = "workspace.json";
export const WORKSPACE_FILE_VERSION = 1;
// Quiet window after the first desktop tab pairs with CDP before the daemon
// reconciles the persisted manifest against reconnected tabs and opens the
// missing ones — long enough for surviving tabs (a daemon restart with the
// browser left open) to reattach and be counted, short enough to feel
// instant on a fresh start (only the bootstrap tab is open).
export const WORKSPACE_RESTORE_SETTLE_MS = 2_000;
// Debounce for persisting the live workspace manifest to disk on attach/
// detach churn, so a flurry of tab opens/closes writes once, not per event.
export const WORKSPACE_SNAPSHOT_DEBOUNCE_MS = 2_000;
// Automatic detection is event-driven (no timer): a `ps` snapshot is taken only
// in response to a foreground change or a session connect/disconnect. This
// debounce window coalesces a burst of such events into a single snapshot; it
// fires once and does not repeat.
export const CAFFEINATE_AUTO_POKE_DEBOUNCE_MS = 150;
// When the activity gate is enabled, caffeinate only stays active while a
// recognized program is producing output. This debounce is the grace period
// after the last output byte before caffeinate turns off — long enough that
// an agent's brief "thinking" pause does not drop the power assertion
// mid-task, short enough to release promptly when the program goes idle.
export const CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS = 5_000;
export const MAX_CAFFEINATE_COMMANDS = 50;
export const MAX_CAFFEINATE_COMMAND_LENGTH = 128;
// Battery floor for keep-awake: when the machine is on battery power and at or
// below this percent, the daemon refuses to hold the power assertion (it stops
// caffeinate without changing the selected mode). The default is on, so a
// machine left unplugged stops keeping itself awake before it dies. `null`
// (selectable in the menu as "Off") disables the guard entirely.
export const CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT = 20;
export const CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT = 5;
export const CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT = 50;
// The battery floor is enforced by reading the machine's battery state on an
// adaptive schedule rather than a fixed heartbeat. The probe (macOS `pmset -g
// batt`; Linux sysfs `/sys/class/power_supply`) reports the charge percent and
// an EWMA "time to empty" estimate; the next delay is 1/TIME_FRACTION of the
// interpolated time-to-threshold (estimate × charge fraction still above the
// floor), so polling tightens as the floor approaches and stays lax far from
// it. Halving (not subtracting a fixed margin) scales the buffer with the
// estimate: the EWMA lags real discharge and the active program drains faster
// than the idle minutes it averaged, so a 2× buffer absorbs a stale-high
// estimate without overshooting. Clamped to [MIN, MAX]: MIN keeps a
// near-threshold reading from busy-looping and drives fast recovery while
// suppressed; MAX bounds the far-from-threshold and on-AC cases. The floor is
// a courtesy guard — the OS still forces low-battery sleep regardless of
// keep-awake (~5% on macOS, configurable via upower/logind's
// CriticalBatteryAction on Linux) — so a multi-minute MAX is an acceptable
// worst-case latency for noticing an unplug or a stalled estimate.
export const CAFFEINATE_BATTERY_POLL_MIN_INTERVAL_MS = 5_000;
export const CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS = 15 * 60_000;
// Poll at 1/N of the interpolated time-to-threshold. N=2 gives a 2× buffer
// against the OS estimate being stale-high.
export const CAFFEINATE_BATTERY_POLL_TIME_FRACTION = 2;
export const CAFFEINATE_BATTERY_READ_TIMEOUT_MS = 2_000;

// Per-process secret injection. Secret values live in a backend (macOS Keychain
// on darwin via `security`; an encrypted file for non-darwin is a later phase),
// never in plaintext on disk. A secret is an identity + the env var it exports
// (name + envVar, stored in ~/.localterm/secrets.json). A process is a binary
// name plus the secret names it should receive (stored in
// ~/.localterm/processes.json) — the same multi-select model automations use
// for their requestedSecrets. The daemon generates a PATH shim per process in
// ~/.localterm/shims that resolves the secret(s) and execs the real binary, so
// only the shimmed program's process ever sees the value (per-process scoping).
// localterm's shell hook prepends the shims dir AFTER the user's rc files run,
// so the shims reliably shadow the real binaries despite rc PATH manipulation
// (e.g. `export PATH=/opt/homebrew/bin:$PATH`). Names (secret + process) are
// immutable identities — a rename would be a delete+recreate, and a delete
// cascades to strip the name from every automation's and process's
// requestedSecrets, so an editable name would silently disconnect wiring.
export const SECRETS_FILE_VERSION = 2;
export const SECRETS_FILENAME = "secrets.json";
export const PROCESSES_FILE_VERSION = 1;
export const PROCESSES_FILENAME = "processes.json";
export const THEMES_FILENAME = "themes.json";
export const THEMES_FILE_VERSION = 1;
export const FONTS_FILENAME = "fonts.json";
export const FONTS_FILE_VERSION = 1;
export const SECRETS_SHIMS_DIRNAME = "shims";
export const LOCALTERM_STATE_DIRNAME = ".localterm";
// Subdir of the state dir holding one activity-signal file per watched
// program. The program's PATH shim overwrites its file (named for the program)
// with the shell's $PWD after the real binary exits, and the daemon's
// ProcessActivityWatcher reacts via fs.watch — no polling. Lives under
// ~/.localterm so the shim (which already bakes the state dir) can reach it.
export const ACTIVITY_DIRNAME = "activity";
// Built-in programs whose shims emit an after-exec activity signal in addition
// to (or instead of) secret injection. The signal fires after the real binary
// completes, so consumers read post-command state (e.g. a refreshed PR lease
// after `gh pr merge`). The process-tree walker is the wrong tool for these —
// they're short-lived CLIs that exit before a `ps` snapshot can catch them — so
// the shim is the deterministic hook point. Add programs here to extend.
export const ACTIVITY_WATCHED_PROGRAMS: readonly string[] = ["gh"];
// Coalesces a burst of activity writes for one cwd into a single consumer
// refresh. The signal arrives after the program exits, so this only needs to
// collapse rapid-fire invocations (e.g. `gh pr merge && gh pr checks`), not to
// wait for the command to finish.
export const ACTIVITY_REFRESH_DEBOUNCE_MS = 500;
export const SECRET_KEYCHAIN_SERVICE_PREFIX = "localterm:";
export const MAX_SECRETS = 64;
export const MAX_PROCESSES = 64;
export const MAX_CUSTOM_THEMES = 64;
export const MAX_SECRET_NAME_LENGTH = 64;
export const MAX_SECRET_ENV_VAR_LENGTH = 64;
export const MAX_PROCESS_NAME_LENGTH = 128;
export const MAX_THEME_NAME_LENGTH = 64;
export const MAX_THEME_ID_LENGTH = 64;
export const MAX_THEME_SOURCE_LENGTH = 128;
export const MAX_THEME_IMPORT_TEXT_LENGTH = 256 * 1024;
// Font ids are short slugs ("geist-mono"); the "custom" pseudo-id is the only
// non-catalog id. The custom family is a free-form CSS name the OS resolves
// ("JetBrainsMono Nerd Font Mono"), capped to bound a runaway value.
export const MAX_FONT_ID_LENGTH = 64;
export const MAX_CUSTOM_FONT_FAMILY_LENGTH = 128;
export const MAX_PROCESS_REQUESTED_SECRETS = 32;
export const MAX_SECRET_VALUE_LENGTH = 8192;
// Versioned plaintext shape the age-encrypted export wraps. Independent of
// SECRETS_FILE_VERSION (the on-disk policy file): the export is a portable
// {version, secrets:[{name,envVar,value}]} blob a future format can bump
// without touching the policy store. Decrypt validates the literal so a
// mismatched file fails closed rather than silently mis-parsing.
export const SECRET_EXPORT_VERSION = 1;
// Caps the export passphrase sent over the loopback body so a runaway body
// can't pin the daemon on scrypt. Generous (a passphrase is never this long);
// the real minimum (non-empty) is enforced by the request schema.
export const MAX_SECRET_EXPORT_PASSPHRASE_LENGTH = 4096;
// Scrypt work factor (log2 N) for the age passphrase on secrets export. age's
// default is 18; the noble pure-JS scrypt makes each export ~1-2s, acceptable
// for a one-time bulk export of all secrets. Tests inject a lower factor.
export const SECRET_EXPORT_SCRYPT_WORK_FACTOR = 18;
// `security` is always at /usr/bin/security on darwin; baking the absolute path
// into the generated shim means the shim doesn't depend on PATH lookup.
export const SECURITY_BINARY_PATH = "/usr/bin/security";

export const TITLE_MAX_PATH_SEGMENTS = 1;

/**
 * Strip terminal-emulator identity env vars inherited from the daemon's parent.
 * If we leak e.g. TERM_PROGRAM=ghostty, modern Ink-based TUIs (Cursor Agent,
 * Claude Code) will probe for that terminal's protocol (kitty keyboard,
 * XTQVERSION, XTGETTCAP, OSC 1337, etc.) and — when xterm.js doesn't answer —
 * fall back to a degraded inline-plain rendering instead of the full boxed
 * TUI. Removing these lets the TUI treat us as a generic xterm-256color and
 * render normally.
 */
export const PTY_ENV_DENYLIST = [
  "LOCALTERM_DAEMON_CHILD",
  "LOCALTERM_INITIAL_COMMAND",
  "LOCALTERM_SESSION_ID",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "ITERM_SESSION_ID",
  "ITERM_PROFILE",
  "KITTY_WINDOW_ID",
  "KITTY_PID",
  "WT_SESSION",
  "WT_PROFILE_ID",
  "GHOSTTY_RESOURCES_DIR",
  "GHOSTTY_BIN_DIR",
  "VSCODE_INJECTION",
  "VSCODE_GIT_IPC_HANDLE",
  "ZDOTDIR",
];

export const MAX_INPUT_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
// Cap for a pasted/shared image upload (POST /api/upload-image). A phone
// screenshot is ~1-3 MB and a photo ~5-12 MB; 32 MB is generous for any real
// raster while rejecting an accidental or hostile dump that would wedge the
// multipart parse.
export const MAX_IMAGE_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_FOREGROUND_LENGTH = 256;
export const MAX_TITLE_LENGTH = 4 * 1024;
export const MAX_NOTIFICATION_LENGTH = 1024;
export const MAX_PENDING_PARSE_BYTES = 4096;
export const MAX_COLS = 1000;
export const MAX_ROWS = 1000;
export const MAX_CONCURRENT_SESSIONS = 64;
// Shells localterm installs prompt hooks (osc7, git-dirty, automation-exit)
// into via prepareOsc7Hook. An initial command for one of these runs via the
// hook (eval) instead of a PTY write, so it never goes through the line
// editor's typed-input path and can't race ECHO or double-echo. Other shells
// (sh, dash, arbitrary) have no hook to eval with and get the at-spawn PTY
// write.
export const HOOKED_SHELL_NAMES = new Set(["zsh", "bash", "fish"]);
// High/low water marks gate the PTY -> WS pipe instead of killing the socket.
// Crossing the high water mark pauses the PTY so the OS pipe absorbs further
// child output until the WS drains below the low water mark, at which point
// we resume. Anything past WS_BACKPRESSURE_THRESHOLD_BYTES is treated as a
// runaway: the WS *did* drain below low water at some point, the receiver is
// genuinely stuck, and we'd rather drop the connection than balloon memory.
export const WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES = 4 * 1024 * 1024;
export const WS_OUTBOUND_RESUME_LOW_WATER_BYTES = 1 * 1024 * 1024;
export const WS_OUTBOUND_DRAIN_POLL_MS = 50;
export const WS_BACKPRESSURE_THRESHOLD_BYTES = 64 * 1024 * 1024;

// Output batch early-flush threshold. DEC synchronized-output redraws flush at
// their explicit DECRST 2026 boundary; the OUTPUT_BATCH_WINDOW_MS timer remains
// authoritative for low-throughput streams without that boundary (keystroke
// echo and unsynchronized TUI redraws of 3–6KB on a 120×40 terminal). It
// coalesces the per-chunk data events of one logical frame into a single
// message, which xterm.js parses atomically —
// splitting a frame causes the half-erased frame to render and flicker (visible
// on every keypress in cmd/Claude Code). Unsynchronized TUI frames rarely
// approach this threshold, so the timer governs them — EXCEPT a full-screen
// repaint of a large session (a big pi/Claude Code conversation, a wide terminal
// with heavy SGR styling), which can exceed the old 32KB threshold and split
// across messages. Over a bandwidth-limited link each split arrives as its own
// atomic WebSocket message and xterm paints it separately — the visible
// top-to-bottom crawl. Raising the threshold to 64KB keeps a big single redraw
// as one message (the browser receives it atomically, one paint) while staying
// under xterm's 12ms parse-yield budget (a 64KB write parses in ~4–6ms, measured), so a
// single message never spills to xterm's async drain (no partial paint).
//
// This threshold also governs high-throughput output (cat of large files, full
// TTY repaints, `gcc -v`, ~15MB/s), where the threshold not the timer sets the
// message rate. There the dominant cost is per-message RunTask plumbing on the
// renderer main thread: every WS message arrives in its own V8 task whose
// median 0.30ms body is ~88% fixed V8/Chrome task-lifecycle overhead and only
// ~12% the onmessage JS (measured 1364 msg/sec => 36.5% main thread on pure
// per-message overhead). At 64KB the message rate halves vs the old 32KB (~470
// => ~235 msg/sec at 15MB/s), halving that fixed overhead to ~1.2ms/frame.
// xterm's own parser amortises the parse cost across batched bytes; a 64KB
// batch parses in ~4–6ms (under its 12ms chunk cap), so no yield, no partial.
// Batch latency at this size is ~4ms at 15MB/s, imperceptible; the keep-warm
// rAF on the client holds needsBeginFrame=1 across inter-arrival gaps
// regardless of burst heaviness, so fatter-but-rarer batches do not reintroduce
// the 122ms hibernation stalls.
export const OUTPUT_BATCH_FLUSH_BYTES = 64 * 1024;

// Output batching fallback for streams without an explicit synchronized-output
// end boundary. The kernel PTY delivers child writes in 1024-byte chunks on
// macOS, and node-pty emits each chunk as a separate data event in
// its own event loop iteration — a setImmediate scheduled on the first chunk
// fires before the remaining chunks of the same child write are read. That
// split a single ink/TUI redraw frame (erase + repaint, ~3KB) across multiple
// WebSocket messages, and xterm.js rendering between them flashed the
// half-erased frame (visible flicker in cmd/Claude Code on every keypress).
// The window RESETS on every chunk (onSessionOutput clears and re-arms the
// timer per data event), so it flushes OUTPUT_BATCH_WINDOW_MS after the LAST
// chunk of a burst — not a fixed window after the first. A full-screen
// repaint of a large session emits over more than the window; a one-shot
// window split it mid-redraw, and over a bandwidth-limited link each split
// arrived as its own atomic message and painted separately (the visible
// top-to-bottom crawl). The resetting window coalesces the whole burst into
// one message so the browser receives it atomically and xterm renders it in
// a single paint regardless of link bandwidth.
// For continuous high-throughput output the window never idles, so
// OUTPUT_BATCH_FLUSH_BYTES triggers an immediate flush regardless of the
// timer, keeping the data flowing.
export const OUTPUT_BATCH_WINDOW_MS = 2;
// Output compression. The server compresses each binary output frame for
// viewers that advertised a decompressor in the {ready} handshake; viewers
// that didn't get the raw bytes (backward-compatible). A header tags the frame
// so the client knows how to handle the payload:
//   0x00 = raw (1-byte header; below threshold OR a raw-mode viewer)
//   0x01 = gzip per-frame (1-byte header; widest fallback: Chrome 80+)
//   0x02 = brotli per-frame (1-byte header; Chrome 105+ / Safari 16.4+)
//   0x03 = brotli context-takeover (5-byte header: 0x03 + 4-byte LE raw size;
//          the persistent stream compresses each frame against the prior
//          screen — the delta). The raw size lets the client size-delimit the
//          frame: the persistent DecompressionStream doesn't end per frame, so
//          the decoder emits the frame in arbitrary 16KB chunks (measured) and
//          only the raw-size bound recovers the frame boundary.
// Brotli q6 on a 64KB frame (the batcher cap) hits ~10x — a 200KB redraw crosses
// a 10Mbps 5G link in ~16ms instead of ~160ms (one paint, not a crawl). The
// context-takeover delta adds 1.24–3.7x on top (measured: 3.7x for a 1-row TUI
// update, 1.24x for a SIGWINCH re-wrap) — the prior screen primes the LZ77
// window so unchanged rows compress to back-references. gzip L3 is the fallback
// for browsers without DecompressionStream("br"). Frames below the threshold
// skip compression (the deflate header would cost more than it saves) and ship
// as 0x00 raw.
export const WS_OUTPUT_RAW = 0x00;
export const WS_OUTPUT_GZIP = 0x01;
export const WS_OUTPUT_BROTLI = 0x02;
export const WS_OUTPUT_BROTLI_CTX = 0x03;
export const WS_OUTPUT_CTX_HEADER_BYTES = 5; // 0x03 + 4-byte LE raw size
export const WS_OUTPUT_COMPRESS_THRESHOLD_BYTES = 256;
export const WS_OUTPUT_BROTLI_QUALITY = 6;
export const WS_OUTPUT_GZIP_LEVEL = 3;

// Heartbeat: send a WS ping every N ms; if no pong arrives within the timeout
// we tear down the socket. Without this, half-open connections (laptop sleep,
// VPN dropout, kernel‑side TCP keepalives at 2h+) wedge the session — the
// server keeps a dead PTY tied to a phantom client and the browser eventually
// trips its own write error and shows "Shell ended" with no idea why.
export const WS_HEARTBEAT_INTERVAL_MS = 20_000;
export const WS_HEARTBEAT_TIMEOUT_MS = 60_000;
// Per-session scrollback ring buffer, appended continuously from the PTY's
// output regardless of how many clients are attached (including zero). When a
// tab switches to this PTY it requests the buffer via the {type:"ready"}
// handshake and the server replays it as one binary frame, so the landing
// screen shows recent output instead of a blank terminal. The attached
// client's own xterm scrollback remains the long-term history; this is only
// the "what you'd see right now" snapshot for a fresh attach. Capped per
// session — at MAX_CONCURRENT_SESSIONS the worst case is this × the cap.
export const SESSION_SCROLLBACK_REPLAY_BYTES = 256 * 1024;
// How long a PTY with zero attached clients stays alive before being reaped.
// One authority (the tab that spawned it, or another joining via the picker)
// keeps a shell alive by subscribing; when the last subscriber leaves the
// shell gets this long to be re-attached — a transient WS drop, a switch in
// progress, a reconnect after wake — before it's killed. Past it the next
// connect spawns a fresh shell. This bounds zombie shells: a shell nobody is
// viewing dies within the window, not after a long idle timeout. Sized for
// the browser's reconnect/switch cycle plus wake-from-sleep latency when the
// WS was dropped by a proxy (portless's two-socket pipe tears down on either
// side's close/error/end during wake, surfacing as 1006 before the client
// even tries to reconnect).
export const SESSION_GRACE_MS = 30_000;
// User-tunable bounds for the no-clients grace window (Settings → Sessions →
// Grace period), expressed in seconds in ~/.localterm/config.json. `null` means
// "never reap" — a dormant shell lingers until killed from the switcher or
// evicted when MAX_CONCURRENT_SESSIONS is reached. `0` reaps an idle shell the
// instant its last viewer detaches. The default mirrors SESSION_GRACE_MS; the
// cap is a sane ceiling for a finite value, with "Off" covering anything longer.
export const SESSION_GRACE_DEFAULT_SECONDS = SESSION_GRACE_MS / 1000;
export const SESSION_GRACE_MIN_SECONDS = 0;
export const SESSION_GRACE_MAX_SECONDS = 3_600;
// Output recency used to compute a session's favicon-equivalent state for the
// session list (recent output = running, a foreground process but quiet =
// alive-quiet, idle = ready) AND to gate the grace reap: a dormant session
// with output still arriving is kept alive — never reaped mid-command — and
// is only eligible once output has gone quiet for this long and no foreground
// program is running. Matches the
// client's favicon-ready debounce (the same "no activity → grey" signal that
// turns the tab's favicon blue/grey), so the session list's row color and the
// grace decision read from the same source of truth.
export const SESSION_ACTIVITY_WINDOW_MS = 750;
// How long a freshly-attached client stays "pending" — its live output is
// buffered per-client until it sends {type:"ready", replay} (the localterm
// client does this within milliseconds of the session frame, so its scrollback
// replay lands before live fan-out for a clean switch). A back-compat client
// that never sends ready (and never sends input) is auto-promoted after this
// window with a buffered-output flush so it still receives its output — no
// output is ever lost. Must exceed the worst attach round-trip the client can
// see: the {session} frame travels server→client and {ready} travels back, so
// the timer races a full RTT, and a mobile tab fronted by `tailscale serve`
// (often DERP-relayed) can see 200–400ms RTTs — 100ms auto-promoted first on a
// slow link, and since the client had already opened its suppressed-replay
// window on the {session} frame the replay-end it was waiting for never came
// (the auto-promote skips the replay), deadlocking it on a blank screen.
// 2s clears even a flaky relayed tailnet with room to spare while staying well
// under any user-perceptible delay for the back-compat fallback.
export const SESSION_PENDING_PROMOTE_TIMEOUT_MS = 2_000;
// Query param a reconnecting or switching client carries to attach to a live
// PTY by id instead of spawning a fresh shell.
export const SESSION_ID_QUERY_PARAM = "sid";
// Query param a reconnecting or switching client carries to attach to a live
// PTY by id instead of spawning a fresh shell.
// The per-browser-profile handle a terminal tab carries so the daemon can group
// the clients attached to a session by profile (for the session picker's peer
// display). Minted client-side and persisted in `localStorage`, which the
// browser partitions per profile, so every tab/window of one profile shares it
// and a different profile gets a different one.
export const WINDOW_ID_QUERY_PARAM = "wid";
// Query param an automation-run tab carries so the server can claim the run
// (single-use) and pair the WS with the CDP target that opened it.
export const AUTOMATION_RUN_QUERY_PARAM = "run";
// When the interval fires with a stale `lastPongAt` (the common case after a
// laptop wake — the wall clock advanced during sleep, but the loopback socket
// itself never actually dropped), send one fresh ping before tearing down. A
// live socket pongs within the grace window and the connection survives; a
// truly half-open one stays silent and terminates on the next tick. Sized to
// absorb a slow WS round-trip through a TLS proxy (portless on :443) without
// leaving a dead session hanging past one extra interval.
export const WS_HEARTBEAT_GRACE_MS = 15_000;
// Keepalive for the daemon's one persistent CDP WebSocket (browser tab control
// for automations). After a laptop sleep the browser is often suspended and
// drops the debug WebSocket while the daemon's loopback socket still reads
// OPEN — a half-open socket the next `Target.createTarget` call would stall
// against for the full call timeout before the open-path catch closes it. The
// heartbeat probes liveness after a quiet window so a dead-OPEN socket is
// torn down proactively and the next run reconnects cleanly instead of paying
// that stall; a socket that genuinely survived (still OPEN and the browser
// still replies) is reused, avoiding a needless reopen.
export const CDP_HEARTBEAT_INTERVAL_MS = 20_000;
export const CDP_HEARTBEAT_TIMEOUT_MS = 60_000;
// Reply-wait granted to the keepalive's liveness probe before it declares the
// socket stale — mirrors WS_HEARTBEAT_GRACE_MS's "one grace chance before
// terminate": the probe uses this (not the per-call timeout) so a slow-but-live
// browser (post-wake scheduling delay, a momentary main-thread block on a
// devtools fork) replies in time and is reused, not torn down. Under the
// interval so a probe never overlaps the next tick.
export const CDP_HEARTBEAT_GRACE_MS = 15_000;
// Dia (The Browser Company) is the only Chromium browser that gates the CDP
// WebSocket open behind an "Allow debugging connection?" prompt (Return =
// Allow). When auto-allow is on and the WS is still CONNECTING past this delay,
// the prompt is up: the daemon fires one Return at the Dia process via osascript
// so its persistent CDP socket connects with no manual click. Measured from
// WebSocket creation — a live WS opens in ~100ms, so "still CONNECTING at
// 600ms" reliably means the prompt is blocking it.
export const CDP_AUTO_ALLOW_DELAY_MS = 600;
// Foreground value reported when a TUI is on the alternate screen but no shell
// hook named the program. Shells without a preexec hook (sh/dash) have no
// foreground-start signal, so the alt-screen enter/exit is the only marker
// that a program is running — enough to keep a closed tab from reaping a
// running editor and to hold the favicon "alive". Never displayed: clients
// treat foreground purely as `!== null` (the favicon alive/idle flag), so an
// opaque marker suffices. Hooked shells (zsh/bash/fish) name the program via
// preexec and take precedence over this fallback.
export const ALT_SCREEN_FOREGROUND = "(alt-screen)";
// Hard ceiling for server.stop() — clients get terminated, then the http
// server is given this long to actually close before we resolve anyway. Keeps
// the daemon's SIGTERM path bounded so the CLI's force-exit fallback never
// fires for normal shutdowns.
export const SERVER_STOP_GRACE_MS = 1_500;

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "[0:0:0:0:0:0:0:1]"]);

export const HTTP_STATUS_NOT_FOUND = 404;
export const HTTP_STATUS_BAD_REQUEST = 400;
export const HTTP_STATUS_ACCEPTED = 202;
export const HTTP_STATUS_CONFLICT = 409;
export const HTTP_STATUS_PAYLOAD_TOO_LARGE = 413;
export const HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE = 415;

// /api/file/content text preview. A hard byte cap keeps a giant generated file
// from ballooning the response, and the NUL-byte sample (git's binary-detection
// window) rejects binaries so the preview never shows mojibake for an image or
// compiled artifact.
export const FILE_PREVIEW_MAX_BYTES = 1_000_000;
export const FILE_PREVIEW_BINARY_SAMPLE_BYTES = 8_000;

// Git diff endpoints. The summary endpoint is polled by the browser every few
// seconds, so every limit here exists to keep one poll cheap and to keep a
// pathological working tree (huge generated file, thousands of untracked
// files) from wedging the daemon or ballooning a single HTTP response.
// SHA of git's well-known empty tree object — the diff base for a repository
// that has no commits yet, so a brand-new repo still reports its staged files.
export const GIT_EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Untracked files aren't covered by `git diff`, so we stat/read them
// ourselves (size+mtime cached between polls). Caps bound the per-poll
// filesystem work; files past the byte cap keep an approximate line count
// from the read prefix and drop their patch.
export const GIT_MAX_UNTRACKED_FILES = 200;
export const GIT_MAX_UNTRACKED_FILE_BYTES = 1 * 1024 * 1024;
// Binary sniff window: a NUL byte in the first 8KB marks a file as binary,
// matching git's own heuristic (buffer_is_binary checks the first 8000 bytes).
export const GIT_BINARY_SNIFF_BYTES = 8000;
// Per-file and whole-response patch caps for /api/git/diff. Files past the
// per-file cap keep their stats but drop the patch text (the viewer shows a
// "too large" notice); past the total cap all remaining patches are dropped.
export const GIT_MAX_PATCH_BYTES_PER_FILE = 1 * 1024 * 1024;
export const GIT_MAX_TOTAL_PATCH_BYTES = 10 * 1024 * 1024;
export const GIT_DIRTY_THROTTLE_MS = 100;
// The diff viewer opens into branch mode when a PR exists, then its prefetch
// queue asks for ~every file's patch. The full diff pass (one tree diff + a
// jsdiff per file) is cached per (cwd, mode, base) so those per-file requests
// are O(1) map lookups instead of each re-running the whole pass (O(files²)).
// Invalidated on a git-dirty signal; this TTL is the backstop for a missed
// invalidation so a stale tree can't be served indefinitely.
export const GIT_CACHE_TTL_MS = 5_000;
// How long a detected PR stays cached per (cwd, branch). PR state changes on
// remote events (push/merge/retarget), not on local working-tree edits, so this
// is deliberately longer than the diff cache TTL and is NOT invalidated by the
// git-dirty signal. The branch is part of the cache key, so switching branches
// naturally misses and refetches.
export const GIT_PR_CACHE_TTL_MS = 60_000;

// "Branch" diff mode compares the working tree against a base branch (via
// merge-base). The GitHub REST API is consulted to discover the current branch's
// PR base; it can hit the network, so any failure degrades to the local
// default-branch heuristic.
// Upper bound on the ref a client may pass as the comparison base. Git refs are
// already short; this just caps a hostile/garbage value before it reaches git.
export const GIT_MAX_REF_LENGTH = 255;
// Cap the branch list returned for the base-branch picker so a repo with
// thousands of remote refs can't bloat the response.
export const GIT_MAX_BRANCHES = 500;
// Safety ceiling on a single git subprocess: kills a hung invocation (a
// pathological repo, or git blocked on something GIT_TERMINAL_PROMPT=0 didn't
// suppress) so the daemon's event loop can't be held indefinitely.
export const GIT_SPAWN_TIMEOUT_MS = 30_000;

// Per-repo worktree preferences (~/.localterm/worktree-configs/<repo-id>.json):
// the setup script to run in each fresh worktree, the custom "Open in…"
// launcher commands, and the default base ref new worktrees branch from.
// Keyed by repo-id (a hash of the main worktree's absolute path) so the config
// is stable regardless of the folder name auto-created worktrees land under.
export const WORKTREE_CONFIG_FILE_VERSION = 1;
export const WORKTREE_CONFIG_DIRNAME = "worktree-configs";
export const REPO_MARKER_FILENAME = ".localterm-repo-id";
export const REPO_ID_HASH_LENGTH = 12;
export const PROJECT_FOLDER_HASH_LENGTH = 6;
export const MAX_PROJECT_FOLDER_ATTEMPTS = 100;
export const MAX_WORKTREE_NAME_ATTEMPTS = 50;
// A setup script can be longer than a one-shot automation command (it may chain
// env copy, install, db migrate, …), but it is injected into a new terminal
// tab via the `?cmd=` query param, so it must stay well under the URL/header
// limit. 8 KiB covers realistic bootstrap one-liners with room to spare.
export const MAX_WORKTREE_SETUP_SCRIPT_LENGTH = 8192;
// "Open in…" custom launcher commands appended to each non-current worktree row
// (e.g. `code .`, `zed .`, `fork .`). Capped so the row menu stays legible.
export const MAX_WORKTREE_OPEN_IN_COMMANDS = 20;
export const MAX_WORKTREE_OPEN_IN_COMMAND_LENGTH = 1024;
export const MAX_WORKTREE_OPEN_IN_LABEL_LENGTH = 64;
export const MAX_WORKTREE_OPEN_IN_ID_LENGTH = 64;
// `.worktreeinclude` (gitignore-syntax) copies gitignored files from the main
// worktree into each fresh worktree so a new checkout is immediately usable
// (.env, config/secrets.json, …). Tracked files are never copied.
export const WORKTREEINCLUDE_FILENAME = ".worktreeinclude";
export const MAX_WORKTREEINCLUDE_FILE_BYTES = 64 * 1024;
export const MAX_WORKTREEINCLUDE_FILES = 500;
export const MAX_WORKTREEINCLUDE_TOTAL_BYTES = 50 * 1024 * 1024;
// Sweep removes stale, clean auto-created worktrees so the shared
// ~/.localterm/worktrees/<project>/ dir doesn't accumulate orphans. A worktree
// is eligible only if it is older than this many days AND has no uncommitted
// changes, no untracked files, and no commits not on a remote-tracking branch.
// Worktrees the user created manually (outside the shared dir) are never swept.
export const WORKTREE_SWEEP_MAX_AGE_DAYS = 30;
export const WORKTREE_SWEEP_BATCH_LIMIT = 100;
// `git fetch` for a PR-based worktree (pull/<N>/head) and the freshness fetch
// for base-ref "fresh" are bounded by the regular git timeout, but a PR number
// is still validated against a generous ceiling before it reaches git.
export const MAX_WORKTREE_PR_NUMBER = 1_000_000;
// A launcher command run by the "Open in…" menu. Spawned detached via the user's
// login shell so rc-sourced PATH entries (nvm, brew, editor CLIs) resolve; the
// spawn is fire-and-forget (output discarded) since these are GUI launches.
export const MAX_LAUNCH_COMMAND_LENGTH = 4096;
// Absolute path to a shell binary, accepted on the WS `?shell=` query param and
// the REST `POST /api/sessions` / `POST /api/exec` `shell` field. A shell path
// is short, but the cap bounds a hostile/garbage value before it reaches the
// filesystem/exec.
export const MAX_SHELL_PATH_LENGTH = 4096;

export const HTTP_STATUS_CREATED = 201;

export const MS_PER_MINUTE = 60_000;

export const MAX_AUTOMATIONS = 100;
export const MAX_AUTOMATION_NAME_LENGTH = 120;
export const MAX_AUTOMATION_COMMAND_LENGTH = 4096;
export const MAX_CRON_EXPRESSION_LENGTH = 256;
export const MAX_AUTOMATION_REQUESTED_SECRETS = 32;
// v1 stored a raw cron string + a single lastRun. v2 stores a structured
// schedule (with a derived cron computed on the fly), a run-count limit, a
// lifecycle, and a capped run-history array. v3 wraps the schedule in a
// top-level `trigger` union so an automation can fire on a schedule OR when a
// folder changes. v4 replaces the top-level `command` with a discriminated
// `runner` union (shell command vs agent prompt) and adds findings/changed-
// files/unread to run records. AutomationStore.load() migrates v1/v2/v3 -> v4
// in place on first boot so existing automations are never lost.
export const AUTOMATIONS_FILE_VERSION = 4;
// Largest "stop after N runs" budget. Generous — a limit is opt-in; the common
// case is "forever".
export const AUTOMATION_RUN_LIMIT_MAX = 100_000;
// Per-automation run-history ring. Newest-first; appendRun trims to this. At
// MAX_AUTOMATIONS the whole history file stays around 1 MB in the worst case.
// Lowered once agent runs started keeping a full log per run — the log (not
// the status badge) is the storage driver now.
export const AUTOMATION_RUN_HISTORY_CAP = 20;
// Schema-level sanity bound on the runs array — far above the trim cap so a
// file written under an older (higher) cap still loads. The actual storage
// bound is the trim cap above, enforced at write time (and normalized on
// load). Decoupled so lowering the trim cap never rejects existing files.
export const AUTOMATION_RUN_HISTORY_SCHEMA_MAX = 1000;
// Most-recent "skipped" entries reconstructed per automation per outage. A
// frequent schedule (every minute) over a multi-day sleep would otherwise
// record thousands of skips and evict every real run from the ring.
export const AUTOMATION_DOWNTIME_RECONCILE_CAP = 10;
// A "multiple times a day" schedule compiles to one cron per distinct time.
export const MAX_AUTOMATION_TIMES_PER_DAY = 12;
// Downtime shorter than this is treated as a clean restart (no reconciliation):
// the daemon writes its heartbeat ~once a minute, so a same-minute bounce must
// not manufacture "skipped" entries.
export const AUTOMATION_RECONCILE_MIN_DOWNTIME_MS = 90_000;
// Cap how far back startup reconciliation enumerates missed occurrences. Bounds
// the work for a frequent (every-minute) schedule after a long outage; we keep
// only the most-recent AUTOMATION_DOWNTIME_RECONCILE_CAP per automation anyway.
export const AUTOMATION_RECONCILE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const DAEMON_HEARTBEAT_FILE_VERSION = 1;
// Ticks land just past the minute boundary so a timer that fires marginally
// early can never evaluate the previous minute twice.
export const AUTOMATION_TICK_ALIGNMENT_DELAY_MS = 50;
// A launched run that no browser tab claims within this window is marked
// "missed" (browser closed, headless host, open() failed silently).
export const AUTOMATION_PENDING_RUN_EXPIRY_MS = 5 * 60 * 1000;
// Quiet period after the last filesystem event before a folder-watch trigger
// fires. Coalesces an event storm (one editor save emits several events; a
// build emits thousands) into a single run. Trailing-edge: the timer resets on
// every event and fires once the directory settles.
export const AUTOMATION_WATCH_DEBOUNCE_MS = 500;
// After a watch-triggered run finishes, the manager keeps the in-flight guard
// on for this long before accepting new events. Prevents a command that
// writes/deletes files in the watched directory (e.g. ffmpeg converting .mov
// to .mp4 and deleting the original) from retriggering itself immediately.
// Events during the grace window are dropped (not queued). 1 second covers
// the observed ~50ms post-exit event lag with a comfortable margin.
export const AUTOMATION_WATCH_POST_RUN_GRACE_MS = 1_000;
// Quiet period after the last session event before an event-triggered automation
// fires. Coalesces a burst of rapid events (e.g. foreground changes during
// process startup, cwd + git-dirty on the same cd) into a single run.
// Trailing-edge: the timer resets on every matching event and fires once the
// session settles.
export const AUTOMATION_EVENT_DEBOUNCE_MS = 500;
// Quiet period after a webhook POST before a webhook-triggered automation
// fires. Coalesces duplicate delivery (a CI retry, an LB double-fire) into a
// single run. Trailing-edge: the timer resets on every POST and fires once the
// burst settles. An in-flight guard separately drops a POST that arrives while
// a prior run is still launching/running.
export const AUTOMATION_WEBHOOK_DEBOUNCE_MS = 500;
// Entropy in a webhook capability id. 128 bits — the standard for unguessable
// capability URLs; well above the ~80-bit threshold for resistance against a
// determined attacker. Emitted as base64url (url-safe, no padding).
export const WEBHOOK_ID_BYTES = 16;
// Upper bound on a stored webhook id's length. A WEBHOOK_ID_BYTES id encodes to
// 22 base64url chars; the slack accommodates a future format change without a
// migration.
export const MAX_WEBHOOK_ID_LENGTH = 64;
// Covers schedules that only fire on Feb 29 (the rarest valid cron target).
export const CRON_NEXT_OCCURRENCE_SCAN_LIMIT_DAYS = 1466;
export const MAX_AUTOMATION_EXIT_CODE_DIGITS = 4;
export const MAX_AUTOMATION_WATCH_FILTER_LENGTH = 255;
// Largest agent-runner prompt (the prompt sent to `pi -p`). Generous like a
// prompt template; shell commands use MAX_AUTOMATION_COMMAND_LENGTH.
export const MAX_AUTOMATION_PROMPT_LENGTH = 4096;
// `--model` pattern passed to `pi`. A short provider/id pattern; not a path.
export const MAX_AUTOMATION_MODEL_LENGTH = 128;
// Truncated stdout captured from an agent run and stored as the run's
// `findings` (the Triage inbox content). Bounded so the run-history ring stays
// small; a longer output is truncated with a marker.
export const MAX_AUTOMATION_FINDINGS_LENGTH = 8000;
// Full per-run log kept on the run record. For shell runs this is a string
// (ANSI-stripped PTY output); for agent runs it's a structured array of
// user/assistant/tool entries (so the UI can render a user/assistant/tool
// transcript and hide thinking behind a toggle). The array branch is bounded
// by entry count here; the agent runner bounds total bytes to the value below.
export const MAX_AUTOMATION_LOG_LENGTH = 65536;
// Defensive cap on the number of structured log entries per agent run.
export const MAX_AUTOMATION_LOG_ENTRIES = 500;
// Truncated tool result text stored in a structured log entry (tool calls can
// emit huge outputs; the assistant/user text is kept full).
export const MAX_AUTOMATION_TOOL_RESULT_LENGTH = 1000;
// Truncated tool-call input (the path/command a tool was invoked with) shown in
// a log entry's header. A short display preview, not the full arguments.
export const MAX_AUTOMATION_TOOL_INPUT_LENGTH = 200;
// Session-transcript tool result caps — match pi core's tool-output truncation
// (core/tools/truncate.js): 2000 lines or 50 KB, whichever hits first. The
// session file is already pi-truncated; these are a safety net for the
// transcript returned over the API (which isn't stored in our file).
export const AUTOMATION_SESSION_TOOL_MAX_LINES = 2000;
export const AUTOMATION_SESSION_TOOL_MAX_BYTES = 50_000;
// Cap on the per-run `changedFiles` list (git status diff before/after). A
// sprawling run won't blow up the history file.
export const MAX_AUTOMATION_CHANGED_FILES = 64;
// Subdirectory of the daemon state dir holding one pi session file per
// thread-mode agent automation (resumed each fire). Fresh-mode runs are
// ephemeral (--no-session) and never land here.
export const AUTOMATION_AGENT_SESSIONS_DIRNAME = "agent-sessions";
// Wall-clock cap on a single agent run. An agent that hangs (stuck tool, a
// model that never stops) is killed and marked failed rather than leaking a
// process and a "running" run forever.
export const AUTOMATION_AGENT_RUN_TIMEOUT_MS = 10 * 60 * 1000;

export const WS_READY_STATE_OPEN = 1;
export const WS_CLOSE_POLICY_VIOLATION = 1008;
export const WS_CLOSE_BACKPRESSURE = 4429;
export const WS_CLOSE_CAPACITY_REACHED = 4503;

// Ambient tab provenance over the WS handshake. The daemon's CDP client injects
// a unique token into every page-type target on our origin (via
// Page.addScriptToEvaluateOnNewDocument so it survives navigations/reloads);
// the page reads `window[LOCALTERM_TAB_TOKEN_PROPERTY]` and echoes it in a
// `{type:"identify"}` WS message so the server pairs the socket with the CDP
// targetId (for reliable closeTab on shell exit). The `localterm-token` event
// fires after the property is set, so a page that already opened its WS with
// `token:null` re-sends once injection lands.
export const LOCALTERM_TAB_TOKEN_PROPERTY = "__LOCALTERM_TAB_TOKEN";
export const LOCALTERM_TAB_TOKEN_EVENT = "localterm-token";
export const MAX_TAB_TOKEN_LENGTH = 128;
// Max length of a client-minted window/profile id (the `?wid=` query param).
// The terminal sends a `crypto.randomUUID()` (36 chars); the cap just bounds a
// hostile/garbage value so it can't bloat the per-client record or the list
// payload. A longer or empty value degrades to the unknown-profile group.
export const MAX_WINDOW_ID_LENGTH = 64;
// Frontend globals the daemon's CDP automation (screenshot/mouse) reads off a
// viewer tab's window, mirroring LOCALTERM_TAB_TOKEN_PROPERTY: well-known names
// so the wire protocol stays authoritative (no parallel literals). The
// pane-text serializer returns the viewport as clean text — the render-landed
// source of truth via a content-equality check against the server-side capture
// renderer (robust against xterm's async write, can't return stale pixels); the
// mouse-cells helper returns the .xterm-screen rect + cell metrics so
// col/row → pixel mapping needs no xterm internals.
export const LOCALTERM_PANE_TEXT_PROPERTY = "__LOCALTERM_PANE_TEXT";
export const LOCALTERM_MOUSE_CELLS_PROPERTY = "__LOCALTERM_MOUSE_CELLS";
// How long the client waits for the daemon's CDP-driven closeTab to settle on
// a clean shell exit before falling back to window.close() + the dead-session
// mask. Generous vs. CLOSE_SETTLE_MS (100ms) + the queued close latency so
// reliable CDP closes don't flash the mask.
export const AMBIENT_TAB_CLOSE_DEADLINE_MS = 1_000;

// Open dev ports: TCP listening sockets owned by processes descended from a
// localterm session shell (a `vite`/`http-server`/`python -m http.server`
// running inside a tab). Discovered by walking the process tree under each
// session pid (ps) and intersecting it with `lsof`'s TCP-LISTEN table. The
// ports modal polls the daemon for this list while open so it reflects a dev
// server starting/stopping in near-realtime.
export const TCP_PORT_MAX = 65_535;
// Deadline for the single HTTP `/json/version` probe used to turn a configured
// CDP port (e.g. Aside's 52860) into a browser-level WebSocket URL when no
// DevToolsActivePort file is available. Short so a dead port fails fast and
// detection falls through to the file-scan candidates.
export const CDP_EXPLICIT_PROBE_TIMEOUT_MS = 1_500;
// Per-candidate deadline for the TCP liveness probe used by `probeCdpLiveness`
// (and the CLI install/start banner). Short so a stale `DevToolsActivePort`
// file — left behind by a crashed/force-quit browser, pointing at a port
// nothing is listening on — fails fast (ECONNREFUSED is near-instant) and the
// probe falls through to the next candidate. Matches the explicit-port HTTP
// probe's deadline so a dead configured port fails at the same speed.
export const CDP_LIVENESS_PROBE_TIMEOUT_MS = 1_500;
// `lsof -nP -iTCP -sTCP:LISTEN` enumerates every listening TCP socket on the
// machine. It can be slow on a busy host and occasionally stalls, so the
// snapshot is capped with a timeout + max buffer and degrades to an empty
// list on any failure (the modal just shows nothing).
export const LSOF_LISTEN_TIMEOUT_MS = 5_000;
export const LSOF_LISTEN_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

// Programmatic PTY control (REST + CLI): the tmux-parity surface for users and
// AI agents. A session created over REST (POST /api/sessions) is "pinned" by
// default — exempt from the no-clients idle grace reap that reaps browser
// tabs' dormant shells — so an agent that spawns now and send-keys minutes
// later doesn't lose its shell mid-use. A pinned shell lives until it's
// explicitly killed or its shell exits, and is never silently evicted at the
// session cap (a pinned shell holding a slot surfaces a capacity error
// instead of being silently reaped). Browser tabs (spawned over the WS) are
// never pinned; their grace-window behavior is unchanged.

// Default and maximum lifetime for an exec call (the synchronous command+
// capture primitive). An agent turn is one exec call, so the default covers a
// long build or test run; the cap bounds a runaway command's hold on the
// daemon's event loop (one exec call holds an output listener + a headless
// terminal for its duration).
export const EXEC_DEFAULT_TIMEOUT_MS = 120_000;
export const EXEC_MAX_TIMEOUT_MS = 30 * 60_000;
// Default and maximum bytes of clean (ANSI-processed) output an exec call
// returns. The headless emulator renders the full captured stream, then the
// result is truncated to this limit and flagged `truncated` so an agent never
// receives an unbounded payload from a chatty command.
export const EXEC_DEFAULT_OUTPUT_LIMIT_BYTES = 1 * 1024 * 1024;
export const EXEC_MAX_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
// Hard ceiling on the raw byte stream an exec call accumulates while watching
// for its completion marker. Bounds memory for a runaway command whose output
// never reaches the marker; once crossed the call stops accumulating and lets
// the timeout (or a session exit) finalize it. Well above the output limit so
// marker detection survives a large-but-finite command.
export const EXEC_RAW_ACCUMULATE_CAP_BYTES = 16 * 1024 * 1024;
// Scrollback the per-exec ephemeral headless terminal keeps. The exec captures
// only the output between its start/end markers, so this just needs to hold one
// command's worth of output without scrolling the end marker out of reach.
export const EXEC_EPHEMERAL_SCROLLBACK = 10_000;
// After an exec times out, the command may still be running in the persistent
// session. Send Ctrl-C + a newline to interrupt it and wait this long for the
// shell to return to a prompt before resolving, so a follow-up exec isn't
// greeted by a half-finished command. A no-op for one-shot exec (the transient
// session is killed regardless).
export const EXEC_TIMEOUT_INTERRUPT_GRACE_MS = 500;
// Maximum lines a capture-pane request may return (the `--lines` ceiling).
// Bounds a response from a session with a huge scrollback.
export const CAPTURE_PANE_MAX_LINES = 10_000;
// Scrollback the persistent per-session capture renderer keeps. Lazily created
// on first capture-pane (zero cost for browser-only sessions that are never
// captured), fed the session's live output thereafter, disposed on session
// exit/kill. Sized to cover a reasonable screenful of history for an agent
// reading a pane without ballooning memory across the session cap.
export const CAPTURE_RENDERER_SCROLLBACK = 10_000;

// CDP-backed screenshot + mouse — the terminal-use parity layer that reuses
// the daemon's existing CDP socket (the one `localterm start` opened for
// background-tab automation) instead of a new rasterizer or input device.
// capture-pane --png opens an ephemeral background tab at `?sid=<id>` (or reuses
// a live viewer tab if one exists), waits for xterm.js to render the session's
// current state, then `Page.captureScreenshot`s the .xterm element. Mouse
// dispatches `Input.dispatchMouseEvent` into the same tab so xterm.js — which
// already speaks SGR mouse natively — generates the sequence, avoiding a
// from-scratch encoder for the browser case (a minimal SGR-1006 fallback covers
// true headless). Pinned sessions (the REST default) survive between calls
// with no tab burning a slot — the exact use case `pinned` was built for.
export const CDP_SCREENSHOT_TIMEOUT_MS = 10_000;
export const CDP_MOUSE_TIMEOUT_MS = 10_000;
export const CDP_RENDER_LANDED_POLL_INTERVAL_MS = 50;
export const CDP_RENDER_LANDED_SETTLE_MS = 80;
// `wait` primitive: subscribe to a session's output and resolve once the
// rendered pane matches a text/regex predicate or goes idle for a window.
// Reuses the tmux-parity capture renderer (flushed per frame) as the source of
// truth — the same grid `capture-pane` and `exec` read.
export const WAIT_DEFAULT_TIMEOUT_MS = 30_000;
export const WAIT_MAX_TIMEOUT_MS = 5 * 60_000;
export const WAIT_IDLE_POLL_INTERVAL_MS = 100;
// `press` (named keys): a human key name → the xterm escape bytes a real
// terminal sends, so an agent writes `press F2` / `press Escape : w q Enter`
// instead of `send-keys '\x1bOQ'`. Space-separated tokens; an unknown token
// passes through as literal text so `press hello` types "hello".
export const MAX_NAMED_KEYS_BYTES = MAX_INPUT_BYTES;

// Identity: a proxy-set header (default `X-Forwarded-User`) fronted by an
// identity-aware reverse proxy (Cloudflare Access, Pomerium, Caddy +
// oauth2-proxy, Authelia forward-auth). The provider only trusts the header
// when the request's source IP is inside `trustedProxy` (default `loopback` —
// the proxy runs on the same host as the daemon, so only loopback can forge
// it). A request with no header resolves to the operator tier (full access).
export const IDENTITY_HEADER_DEFAULT = "X-Forwarded-User";
export const IDENTITY_PROXY_DEFAULT = "loopback";
export const IDENTITY_HEADER_NAME_MAX_LENGTH = 64;
export const IDENTITY_PROXY_SPEC_MAX_LENGTH = 64;
export const IDENTITY_USER_MAX_LENGTH = 256;
// Passkey (self-contained) provider: localterm is its own identity authority via
// WebAuthn. A signed session cookie carries the identity after a register/login
// ceremony so subsequent tabs (and WS upgrades) re-authenticate silently. The
// HMAC secret is generated once and persisted; challenges are short-lived.
export const IDENTITY_RP_NAME_DEFAULT = "localterm";
export const IDENTITY_RP_NAME_MAX_LENGTH = 64;
export const IDENTITY_USERNAME_MIN_LENGTH = 1;
export const IDENTITY_USERNAME_MAX_LENGTH = 256;
export const AUTH_COOKIE_NAME = "localterm-auth";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const AUTH_SECRET_BYTES = 32;
export const AUTH_SECRET_FILENAME = "auth-secret";
export const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const AUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const HTTP_STATUS_UNAUTHORIZED = 401;
export const HTTP_STATUS_FORBIDDEN = 403;

// Update check. The daemon is the long-lived host, so it owns the one npm
// registry lookup shared by every CLI invocation (`localterm start`/`status`
// banner) and every open browser tab (the settings indicator). The result is
// cached to disk so a daemon restart reads the prior value instantly without
// re-fetching, and refreshed on this interval. Set `LOCALTERM_SKIP_UPDATE_CHECK=1`
// (or `~/.localterm/config.json` `updateCheck.enabled: false`) to disable.
export const NPM_PACKAGE_NAME = "@monotykamary/localterm";
export const NPM_REGISTRY_LATEST_URL = `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`;
export const UPDATE_CHECK_FILENAME = "update-check.json";
export const UPDATE_CHECK_FILE_VERSION = 1;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Upper bound on a single registry fetch. A slow/offline network fails fast so
// neither the daemon's event loop nor a blocking `/api/update-status?wait=1`
// (the CLI banner path) hangs waiting on the registry.
export const UPDATE_CHECK_HTTP_TIMEOUT_MS = 3_000;
