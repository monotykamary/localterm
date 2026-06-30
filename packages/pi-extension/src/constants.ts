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
