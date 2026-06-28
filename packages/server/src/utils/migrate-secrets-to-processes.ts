import fs from "node:fs";
import path from "node:path";
import { PROCESSES_FILE_VERSION, PROCESSES_FILENAME, SECRETS_FILE_VERSION } from "../constants.js";
import {
  processesFileSchema,
  processNameSchema,
  secretsFileSchema,
  secretsFileV1Schema,
} from "../schemas.js";
import type { Process, SecretEntry } from "../types.js";

// One-time, in-place migration from the pre-flip secret-centric model to the
// process-centric model. v1 secrets.json stored the binary names a secret shims
// directly on each entry (`programs`); v2 moves that wiring into a separate
// processes.json where a process names which secrets it receives (the same
// multi-select model automations use). The flip is a clean cut-over — the
// stores only know the new shapes, so this runs once at startup, before they
// are constructed, and rewrites both files.
//
// Idempotent: if secrets.json is already v2 (or absent) it no-ops; if it is v1,
// it inverts `programs` into processes, merges with any existing processes.json
// (union of requestedSecrets per process name, deduped, order-stable), writes
// processes.json, then rewrites secrets.json as v2 with `programs` stripped. A
// later boot parses the v2 file and no-ops.
export const migrateSecretsToProcesses = (stateDirectory: string): void => {
  const secretsPath = path.join(stateDirectory, "secrets.json");
  const processesPath = path.join(stateDirectory, PROCESSES_FILENAME);

  let secretsRaw: string;
  try {
    secretsRaw = fs.readFileSync(secretsPath, "utf8");
  } catch {
    return;
  }
  let secretsJson: unknown;
  try {
    secretsJson = JSON.parse(secretsRaw);
  } catch {
    return;
  }

  // Already v2 (or some future shape the store will handle) — nothing to migrate.
  if (secretsFileSchema.safeParse(secretsJson).success) return;

  const v1 = secretsFileV1Schema.safeParse(secretsJson);
  if (!v1.success) return;

  // Invert: for each (secret, program) pair, the program becomes a process that
  // requests that secret. A program listed by several secrets becomes one
  // process requesting all of them, preserving the combined shim the old model
  // produced (buildProgramIndex already merged them per program). Program names
  // are filtered through processNameSchema so a hand-edited v1 file with an
  // invalid name can't produce a processes.json the store then rejects
  // wholesale — invalid names are dropped with a warning instead.
  const migrated = new Map<string, Set<string>>();
  for (const entry of v1.data.secrets) {
    for (const program of entry.programs) {
      const nameParse = processNameSchema.safeParse(program);
      if (!nameParse.success) {
        console.warn(`skipping invalid program name '${program}' during migration`);
        continue;
      }
      const set = migrated.get(nameParse.data) ?? new Set<string>();
      set.add(entry.name);
      migrated.set(nameParse.data, set);
    }
  }

  // Merge with any existing processes.json so a partial/manual processes file
  // isn't clobbered. Union requestedSecrets per name; migrated entries first so
  // an existing process keeps the migrated secrets ahead of its own.
  const existingByName = new Map<string, Set<string>>();
  try {
    const existingRaw = fs.readFileSync(processesPath, "utf8");
    const existing = processesFileSchema.safeParse(JSON.parse(existingRaw));
    if (existing.success) {
      for (const process of existing.data.processes) {
        const set = new Set<string>(process.requestedSecrets);
        existingByName.set(process.name, set);
      }
    }
  } catch {
    // absent or invalid — start from the migrated set only
  }

  const merged = new Map<string, string[]>();
  for (const [name, secrets] of migrated) {
    const existing = existingByName.get(name);
    const combined = [...secrets];
    if (existing)
      for (const secretName of existing) if (!secrets.has(secretName)) combined.push(secretName);
    merged.set(name, combined);
    existingByName.delete(name);
  }
  for (const [name, secrets] of existingByName) {
    merged.set(name, [...secrets]);
  }

  const processes: Process[] = [...merged.entries()].map(([name, requestedSecrets]) => ({
    name,
    requestedSecrets,
  }));

  const secrets: SecretEntry[] = v1.data.secrets.map((entry) => ({
    name: entry.name,
    envVar: entry.envVar,
  }));

  writeJson(processesPath, { version: PROCESSES_FILE_VERSION, processes });
  writeJson(secretsPath, { version: SECRETS_FILE_VERSION, secrets });
};

const writeJson = (filePath: string, payload: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
};
