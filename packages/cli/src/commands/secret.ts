import kleur from "kleur";
import { createDefaultSecretBackend } from "@monotykamary/localterm-server";
import { readFileSync } from "node:fs";
import { daemonBaseUrl, daemonFetch, reportApiError, reportDaemonDown } from "../utils/daemon-api.js";

interface SecretListItem {
  name: string;
  envVar: string;
  hasValue: boolean;
}

const readStdinValue = (): string => readFileSync(0, "utf8").replace(/\r?\n$/, "");

// `localterm secret list` — names + the env var each secret exports + whether a
// value is set. The daemon never returns values over the loopback HTTP surface
// (it's network-origin-gated, not capability-gated), so this lists names only.
// Programs that receive a secret live on processes — list those with
// `localterm process list`.
const runList = async (): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await daemonFetch(`${base}/secrets`);
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
  console.log(`${"NAME".padEnd(nameWidth)}  ${"ENV VAR".padEnd(envWidth)}  VALUE`);
  console.log(`${"─".repeat(nameWidth)}  ${"─".repeat(envWidth)}  ─────`);
  for (const secret of body.secrets) {
    const value = secret.hasValue ? kleur.green("set") : kleur.yellow("no value");
    console.log(
      `${kleur.cyan(secret.name.padEnd(nameWidth))}  ${secret.envVar.padEnd(envWidth)}  ${value}`,
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

// `localterm secret set <name> -e <VAR> [-v <value>]` — upserts the secret's
// env var + value via the daemon (PUT /api/secrets/:name). The value transits to
// the daemon once and is stored in the backend; never returned. `-v -` reads the
// value from stdin (the secure path — no argv exposure to `ps`); omitting `-v`
// is a policy-only update (the daemon rejects a value-less create). The name is
// immutable; to rename, delete and recreate. Wire this secret to a binary with
// `localterm process set`.
const runSet = async (options: { name: string; envVar: string; value?: string }): Promise<void> => {
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
  const response = await daemonFetch(`${base}/secrets/${encodeURIComponent(options.name)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      envVar: options.envVar,
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
  console.log(kleur.dim(`  value: ${created.hasValue ? "set" : "unchanged"}`));
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
  const response = await daemonFetch(`${base}/secrets/${encodeURIComponent(name)}`, {
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
