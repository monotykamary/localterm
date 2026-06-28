import fs from "node:fs";
import path from "node:path";
import { MAX_PROCESSES, PROCESSES_FILE_VERSION } from "./constants.js";
import { processesFileSchema } from "./schemas.js";
import type { Process } from "./types.js";

// Owns the persisted process policy in ~/.localterm/processes.json: the list of
// { name, requestedSecrets } entries. `name` is a binary the shim generator
// wraps; `requestedSecrets` are secret names (never values) the shim resolves.
// Mirrors SecretStore's load/persist shape (zod-validated read, atomic
// tmp+rename write). `requestedSecrets` are stored verbatim up to the cap — no
// dedupe, matching AutomationStore's handling of an automation's
// requestedSecrets so the two containers behave identically.
export class ProcessStore {
  private processes: Process[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  list(): Process[] {
    return this.processes.map((entry) => ({
      name: entry.name,
      requestedSecrets: [...entry.requestedSecrets],
    }));
  }

  get(name: string): Process | undefined {
    return this.processes.find((entry) => entry.name === name);
  }

  size(): number {
    return this.processes.length;
  }

  // Add or replace by name. `entry` is assumed pre-validated by the route's
  // zod parse. Returns the canonicalized entry, or null if adding a new name
  // would exceed MAX_PROCESSES (replacing an existing name doesn't count
  // against the cap). The name is immutable by design: a rename is a delete +
  // create (it is the shim filename, and a delete cascades to strip the name
  // from every automation/process requestedSecrets).
  upsert(entry: Process): Process | null {
    const canonical: Process = {
      name: entry.name,
      requestedSecrets: [...entry.requestedSecrets],
    };
    const existingIndex = this.processes.findIndex((item) => item.name === canonical.name);
    if (existingIndex === -1 && this.processes.length >= MAX_PROCESSES) return null;
    if (existingIndex !== -1) {
      this.processes[existingIndex] = canonical;
    } else {
      this.processes.push(canonical);
    }
    this.persist();
    return { ...canonical, requestedSecrets: [...canonical.requestedSecrets] };
  }

  delete(name: string): boolean {
    const index = this.processes.findIndex((entry) => entry.name === name);
    if (index === -1) return false;
    this.processes.splice(index, 1);
    this.persist();
    return true;
  }

  // Cascade helper for secret deletion: strip `secretName` from every process's
  // requestedSecrets so a deleted secret leaves no dangling reference. Persists
  // only if something changed. The shim generator then rebuilds every shim
  // without the dropped secret. Pair with AutomationStore.removeSecretFromAll so
  // a secret delete cleans up both containers that reference secret names.
  removeSecretFromAll(secretName: string): boolean {
    let changed = false;
    const next = this.processes.map((entry) => {
      if (!entry.requestedSecrets.includes(secretName)) return entry;
      changed = true;
      return {
        name: entry.name,
        requestedSecrets: entry.requestedSecrets.filter((name) => name !== secretName),
      };
    });
    if (changed) {
      this.processes = next;
      this.persist();
    }
    return changed;
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      console.warn(`processes file invalid; ignoring (${this.filePath})`);
      return;
    }
    const parsed = processesFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`processes file invalid; ignoring (${this.filePath})`);
      return;
    }
    this.processes = parsed.data.processes.map((entry) => ({
      name: entry.name,
      requestedSecrets: [...entry.requestedSecrets],
    }));
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: PROCESSES_FILE_VERSION,
      processes: this.processes,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
