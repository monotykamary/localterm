import kleur from "kleur";
import { createDefaultSecretBackend } from "@monotykamary/localterm-server";
import { readFileSync } from "node:fs";
import { readHost, readPort } from "../state.js";

interface SecretListItem {
  name: string;
  envVar: string;
  programs: string[];
  hasValue: boolean;
}

const daemonBaseUrl = (): string => {
  const port = readPort();
  if (!port) throw new DaemonDownError();
  const host = readHost() ?? "127.0.0.1";
  return `http://${host}:${port}/api`;
};

class DaemonDownError extends Error {
  constructor() {
    super("localterm daemon is not running");
  }
}

const reportDaemonDown = (): void => {
  console.log(kleur.red("✗ localterm daemon is not running."));
  console.log(kleur.dim("  start it with `localterm start`, then retry."));
};

const reportApiError = (status: number, body: string): void => {
  console.log(kleur.red(`✗ daemon returned ${status}`));
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) console.log(kleur.dim(`  ${parsed.error}`));
  } catch {
    if (body) console.log(kleur.dim(`  ${body}`));
  }
};

const readStdinValue = (): string => readFileSync(0, "utf8").replace(/\r?\n$/, "");

const parsePrograms = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );
};

// `localterm secret list` — names + policy + whether a value is set. The
// daemon never returns values over the loopback HTTP surface (it's
// network-origin-gated, not capability-gated), so this lists names only.
const runList = async (): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await fetch(`${base}/secrets`);
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  const body = (await response.json()) as { supported: boolean; secrets: SecretListItem[] };
  if (!body.supported) {
    console.log(kleur.yellow("secret storage isn't supported on this server's platform."));
    console.log(kleur.dim("  (it uses macOS Keychain; run the daemon on a Mac.)"));
    return;
  }
  if (body.secrets.length === 0) {
    console.log(kleur.dim("no secrets. add one with `localterm secret set`."));
    return;
  }
  const nameWidth = Math.max(4, ...body.secrets.map((secret) => secret.name.length));
  const envWidth = Math.max(7, ...body.secrets.map((secret) => secret.envVar.length));
  console.log(
    `${"NAME".padEnd(nameWidth)}  ${"ENV VAR".padEnd(envWidth)}  ${"PROGRAMS".padEnd(12)}  VALUE`,
  );
  console.log(`${"─".repeat(nameWidth)}  ${"─".repeat(envWidth)}  ${"─".repeat(12)}  ─────`);
  for (const secret of body.secrets) {
    const programs = secret.programs.join(",") || kleur.dim("(none)");
    const value = secret.hasValue ? kleur.green("set") : kleur.yellow("no value");
    console.log(
      `${kleur.cyan(secret.name.padEnd(nameWidth))}  ${secret.envVar.padEnd(envWidth)}  ${programs}  ${value}`,
    );
  }
};

// `localterm secret get <name>` — resolves the value from the backend (macOS
// Keychain) directly, NOT through the daemon's HTTP API. This mirrors the
// generated shim's resolution path and preserves the "values never cross the
// network" property: the value goes Keychain → CLI process → stdout, never
// through the loopback server. Works even when the daemon is down — the
// Keychain entry persists independently. Prints the value to stdout (with a
// trailing newline, which `$()` strips for `VAR=$(localterm secret get x)`).
const runGet = async (name: string): Promise<void> => {
  const backend = createDefaultSecretBackend();
  if (!backend.supported) {
    console.log(kleur.red("✗ secret storage isn't supported on this platform."));
    console.log(kleur.dim("  (it uses macOS Keychain; run on a Mac.)"));
    process.exitCode = 1;
    return;
  }
  const value = await backend.get(name);
  if (value === null) {
    console.log(kleur.red(`✗ no secret named '${name}'.`));
    console.log(kleur.dim("  list with `localterm secret list`."));
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${value}\n`);
};

// `localterm secret set <name> -e <VAR> [-p <a,b>] [-v <value>]` — upserts the
// policy + value via the daemon (PUT /api/secrets/:name). The value transits to
// the daemon once and is stored in the backend; never returned. `-v -` reads
// the value from stdin (the secure path — no argv exposure to `ps`); omitting
// `-v` is a policy-only update (the daemon rejects a value-less create).
const runSet = async (options: {
  name: string;
  envVar: string;
  programs?: string;
  value?: string;
}): Promise<void> => {
  if (!options.envVar) {
    console.log(kleur.red("✗ --env-var is required."));
    process.exitCode = 1;
    return;
  }
  let value: string | undefined;
  if (options.value !== undefined) {
    value = options.value === "-" ? readStdinValue() : options.value;
  }
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await fetch(`${base}/secrets/${encodeURIComponent(options.name)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      envVar: options.envVar,
      programs: parsePrograms(options.programs),
      ...(value !== undefined ? { value } : {}),
    }),
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  const created = (await response.json()) as SecretListItem;
  console.log(kleur.green(`✓ saved '${created.name}' → ${created.envVar}`));
  console.log(
    kleur.dim(
      `  programs: ${created.programs.join(", ") || "(none)"}  ·  value: ${created.hasValue ? "set" : "unchanged"}`,
    ),
  );
};

// `localterm secret delete <name>` — removes the policy entry and the backend
// value (Keychain item) via the daemon.
const runDelete = async (name: string): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await fetch(`${base}/secrets/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  console.log(kleur.green(`✓ deleted '${name}'`));
};

export const runSecretList = runList;
export const runSecretGet = runGet;
export const runSecretSet = runSet;
export const runSecretDelete = runDelete;
