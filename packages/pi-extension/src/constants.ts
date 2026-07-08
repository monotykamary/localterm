// localterm's state directory and the two policy files the scrub reads. These
// hold names + env vars only — NEVER secret values (values live in the macOS
// Keychain) — so reading them never touches a key. Mirrors the same constants
// in localterm-server so the paths stay in lockstep.
export const LOCALTERM_STATE_DIRNAME = ".localterm";
export const SECRETS_FILENAME = "secrets.json";
export const PROCESSES_FILENAME = "processes.json";

// The process name localterm wraps with a PATH shim. The scrub strips exactly
// the secrets this process is wired to, mirroring what the shim injected.
export const PI_PROCESS_NAME = "pi";

// pi's settings file name (global ~/.pi/agent/settings.json + project
// <cwd>/.pi/settings.json). The bash override reads these to preserve a
// user's configured shell + command prefix.
export const PI_SETTINGS_FILENAME = "settings.json";

// Canonical validation patterns — mirror localterm-server's zod schemas so a
// malformed or hostile policy file can never trick the scrub into deleting an
// unrelated env var. An env var in particular must match the strict uppercase
// identifier shape a real secret envVar always has.
export const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const PROCESS_NAME_PATTERN = /^[A-Za-z0-9_.+-]+$/;
export const ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

// Mirror localterm-server's MAX_NOTIFICATION_LENGTH: the daemon slices any
// OSC 9 body past this many UTF-16 code units, which can split a surrogate
// pair. We cap the body ourselves before framing so the emitted sequence is
// always within the daemon's limit and never split. Used by the OSC 9
// notification builder.
export const NOTIFICATION_MAX_LENGTH = 1024;

// Only push a desktop notification when the agent turn ran at least this long,
// so quick back-and-forth turns don't spam a user actively watching the pi
// tab. Tunable: lower to notify sooner, raise to stay quieter while focused.
export const AGENT_NOTIFY_MIN_ELAPSED_MS = 30_000;
