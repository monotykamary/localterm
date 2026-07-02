import kleur from "kleur";
import { daemonBaseUrl, daemonFetch, reportApiError, reportDaemonDown } from "../utils/daemon-api.js";

interface ProcessListItem {
  name: string;
  requestedSecrets: string[];
}

const parseSecretNames = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

// `localterm process list` — the binaries localterm wraps with a PATH shim and
// the secret names each receives. Values never appear (the shim resolves them
// from the Keychain at exec time); only the wiring is listed.
const runList = async (): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await daemonFetch(`${base}/processes`);
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  const body = (await response.json()) as { processes: ProcessListItem[] };
  if (body.processes.length === 0) {
    console.log(kleur.dim("no processes. add one with `localterm process set`."));
    return;
  }
  const nameWidth = Math.max(4, ...body.processes.map((process) => process.name.length));
  console.log(`${"BINARY".padEnd(nameWidth)}  SECRETS`);
  console.log(`${"─".repeat(nameWidth)}  ────────────────────────────────────────`);
  for (const process of body.processes) {
    const secrets = process.requestedSecrets.join(", ") || kleur.dim("(none — no shim generated)");
    console.log(`${kleur.cyan(process.name.padEnd(nameWidth))}  ${secrets}`);
  }
};

// `localterm process set <name> [-s <a,b>]` — sets the secret names a binary
// receives (PUT /api/processes/:name). An empty `-s` clears the selection (and
// removes the shim). The daemon validates every name exists in the secret
// store, so a typo is rejected rather than silently producing a no-op shim. The
// name is the shim filename and is immutable; to rename, delete and recreate.
const runSet = async (options: { name: string; secrets?: string }): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const requestedSecrets = parseSecretNames(options.secrets);
  const response = await daemonFetch(`${base}/processes/${encodeURIComponent(options.name)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestedSecrets }),
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  const created = (await response.json()) as { process: ProcessListItem };
  console.log(
    kleur.green(
      `✓ ${created.process.name} → ${created.process.requestedSecrets.join(", ") || "(no secrets)"}`,
    ),
  );
};

// `localterm process delete <name>` — removes the process and its shim.
const runDelete = async (name: string): Promise<void> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return;
  }
  const response = await daemonFetch(`${base}/processes/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return;
  }
  console.log(kleur.green(`✓ deleted process '${name}'`));
};

export const runProcessList = runList;
export const runProcessSet = runSet;
export const runProcessDelete = runDelete;
