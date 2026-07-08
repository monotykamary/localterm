import kleur from "kleur";
import { createDefaultSecretBackend } from "@monotykamary/localterm-server";
import { readFileSync, writeFileSync } from "node:fs";
import {
  daemonBaseUrl,
  daemonFetch,
  reportApiError,
  reportDaemonDown,
} from "../utils/daemon-api.js";
import { readPassphraseFromTty } from "../utils/read-passphrase.js";

interface SecretListItem {
  name: string;
  envVar: string;
  hasValue: boolean;
}

const readStdinValue = (): string => readFileSync(0, "utf8").replace(/\r?\n$/, "");

const DEFAULT_EXPORT_FILENAME = "localterm-secrets.age";

// Resolve a passphrase from `-p <value>`, `-p -` (stdin), or an interactive
// hidden TTY prompt when `-p` is omitted. `confirm` asks for the passphrase
// twice (export creates one; import reuses an existing one).
const resolvePassphrase = async (raw: string | undefined, confirm: boolean): Promise<string> => {
  if (raw === "-") return readStdinValue();
  if (raw !== undefined) return raw;
  return readPassphraseFromTty("passphrase: ", confirm ? "confirm passphrase: " : undefined);
};

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

// `localterm secret export [-o <file>] [-p <passphrase>]` — encrypts every
// secret's value with an age passphrase (the daemon does the crypto; values
// never leave it in plaintext) and writes the ASCII-armored ciphertext to a
// file. `-o -` writes to stdout; `-p -` reads the passphrase from stdin (the
// secure path — no `ps`/scrollback exposure); omitting `-p` prompts on a TTY.
// The file decrypts with the stock `age` CLI (`age -d -p`) too.
const runExport = async (options: { output?: string; passphrase?: string }): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  let passphrase: string;
  try {
    passphrase = await resolvePassphrase(options.passphrase, true);
  } catch (error) {
    console.log(
      kleur.red(`✗ ${error instanceof Error ? error.message : "couldn't read passphrase"}`),
    );
    process.exitCode = 1;
    return;
  }
  const response = await daemonFetch(`${base}/secrets/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  const body = (await response.json()) as { data: string; count: number; skipped: number };
  if (options.output === "-") {
    process.stdout.write(body.data);
    return;
  }
  const outputPath = options.output ?? DEFAULT_EXPORT_FILENAME;
  writeFileSync(outputPath, `${body.data}\n`, { mode: 0o600 });
  console.log(
    kleur.green(`✓ exported ${body.count} secret${body.count === 1 ? "" : "s"}`),
    kleur.dim(`→ ${outputPath}`),
  );
  if (body.skipped > 0) console.log(kleur.dim(`  ${body.skipped} skipped (no value set)`));
};

// `localterm secret import [-i <file>] [-p <passphrase>]` — decrypts an
// age-armored export and upserts every entry through the daemon's write path
// (same as `secret set`). `-i -` reads the file from stdin; `-p -` reads the
// passphrase from stdin. Reading both from stdin is ambiguous, so it's
// rejected — pipe one and pass the other as a flag. Omitting `-p` prompts on a
// TTY. Values never travel in plaintext over the response.
const runImport = async (options: { input?: string; passphrase?: string }): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  if (options.input === "-" && options.passphrase === "-") {
    console.log(kleur.red("✗ can't read both the file and the passphrase from stdin."));
    console.log(kleur.dim("  pass one via a flag: `-p <passphrase>` or `-i <file>`."));
    process.exitCode = 1;
    return;
  }
  let data: string;
  try {
    data =
      options.input === "-"
        ? readStdinValue()
        : readFileSync(options.input ?? DEFAULT_EXPORT_FILENAME, "utf8");
  } catch {
    console.log(
      kleur.red(
        `✗ couldn't read the export file${options.input ? "" : ` (${DEFAULT_EXPORT_FILENAME})`}.`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  let passphrase: string;
  try {
    passphrase = await resolvePassphrase(options.passphrase, false);
  } catch (error) {
    console.log(
      kleur.red(`✗ ${error instanceof Error ? error.message : "couldn't read passphrase"}`),
    );
    process.exitCode = 1;
    return;
  }
  const response = await daemonFetch(`${base}/secrets/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase, data }),
  });
  if (!response.ok) {
    if (response.status === 400) {
      console.log(kleur.red("✗ wrong passphrase, or not a localterm secrets export file."));
    } else {
      reportApiError(response.status, await response.text());
    }
    process.exitCode = 1;
    return;
  }
  const body = (await response.json()) as {
    imported: number;
    created: number;
    updated: number;
    errors: { name: string; error: string }[];
  };
  console.log(
    kleur.green(`✓ imported ${body.imported} secret${body.imported === 1 ? "" : "s"}`),
    kleur.dim(`(${body.created} new, ${body.updated} updated)`),
  );
  for (const error of body.errors) console.log(kleur.dim(`  ${error.name}: ${error.error}`));
};

export const runSecretList = runList;
export const runSecretGet = runGet;
export const runSecretSet = runSet;
export const runSecretDelete = runDelete;
export const runSecretExport = runExport;
export const runSecretImport = runImport;
