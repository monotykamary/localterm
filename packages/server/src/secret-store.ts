import fs from "node:fs";
import path from "node:path";
import { MAX_SECRETS, SECRETS_FILE_VERSION } from "./constants.js";
import { secretsFileSchema } from "./schemas.js";
import type { SecretEntry } from "./types.js";

interface SecretStoreOptions {
  filePath: string;
  shimsDir: string;
}

// Owns the persisted secret identity in ~/.localterm/secrets.json: the list of
// { name, envVar } entries. Names + env vars only — NEVER values (those live in
// the backend). Mirrors CaffeinatePreferencesStore's load/persist shape
// (zod-validated read, atomic tmp+rename write). The `shimsDir` option is
// threaded through for callers that need it; the store itself does not read it.
export class SecretStore {
  private secrets: SecretEntry[] = [];
  private readonly filePath: string;
  readonly shimsDir: string;

  constructor(options: SecretStoreOptions) {
    this.filePath = options.filePath;
    this.shimsDir = options.shimsDir;
    this.load();
  }

  list(): SecretEntry[] {
    return this.secrets.map((entry) => ({ name: entry.name, envVar: entry.envVar }));
  }

  get(name: string): SecretEntry | undefined {
    return this.secrets.find((entry) => entry.name === name);
  }

  // A name -> envVar lookup for the shim generator, which bakes each requested
  // secret's envVar into a process's shim. Returns undefined for a name that no
  // longer exists (a deleted secret the cascading delete missed, or a stale
  // process file); the generator skips those so a shim never references a
  // missing secret.
  envVarByName(): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of this.secrets) map.set(entry.name, entry.envVar);
    return map;
  }

  // Add or replace by name. `entry` is assumed pre-validated by the route's
  // zod parse. Returns the canonicalized entry, or null if adding a new name
  // would exceed MAX_SECRETS (replacing an existing name doesn't count against
  // the cap). The name is immutable by design: a rename is a delete + create.
  upsert(entry: SecretEntry): SecretEntry | null {
    const canonical: SecretEntry = { name: entry.name, envVar: entry.envVar };
    const existingIndex = this.secrets.findIndex((item) => item.name === canonical.name);
    if (existingIndex === -1 && this.secrets.length >= MAX_SECRETS) return null;
    if (existingIndex !== -1) {
      this.secrets[existingIndex] = canonical;
    } else {
      this.secrets.push(canonical);
    }
    this.persist();
    return { ...canonical };
  }

  delete(name: string): boolean {
    const index = this.secrets.findIndex((entry) => entry.name === name);
    if (index === -1) return false;
    this.secrets.splice(index, 1);
    this.persist();
    return true;
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
      console.warn(`secrets file invalid; ignoring (${this.filePath})`);
      return;
    }
    const parsed = secretsFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`secrets file invalid; ignoring (${this.filePath})`);
      return;
    }
    this.secrets = parsed.data.secrets.map((entry) => ({
      name: entry.name,
      envVar: entry.envVar,
    }));
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: SECRETS_FILE_VERSION,
      secrets: this.secrets,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmpPath, this.filePath);
  }
}
