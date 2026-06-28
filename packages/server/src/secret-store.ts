import fs from "node:fs";
import path from "node:path";
import { MAX_SECRET_PROGRAMS, MAX_SECRETS, SECRETS_FILE_VERSION } from "./constants.js";
import { secretsFileSchema } from "./schemas.js";
import type { SecretEntry } from "./types.js";
import { memoBy } from "./utils/memo-by.js";

interface SecretStoreOptions {
  filePath: string;
  shimsDir: string;
}

// Sanitize the program list the way caffeinate commands are sanitized: trim,
// drop empties, memo by lowercased form (so "Pi" and "pi" don't both shadow),
// and cap the count. Program names are matched case-sensitively by the shell,
// but a user listing both "Pi" and "pi" is almost always a typo, so the dedupe
// is case-insensitive keeping the first spelling.
const sanitizePrograms = (programs: readonly string[]): string[] => {
  const capped = programs.map((raw) => raw.trim().slice(0, 128)).filter(Boolean);
  return memoBy(capped, (program) => program.toLowerCase()).slice(0, MAX_SECRET_PROGRAMS);
};

// Owns the persisted secret policy in ~/.localterm/secrets.json: the list of
// { name, envVar, programs } entries. Names + env vars + programs only — NEVER
// values (those live in the backend). Mirrors CaffeinatePreferencesStore's
// load/persist shape (zod-validated read, atomic tmp+rename write) and the
// caffeinate commands sanitize helper for the program list.
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
    return this.secrets.map((entry) => ({
      name: entry.name,
      envVar: entry.envVar,
      programs: [...entry.programs],
    }));
  }

  get(name: string): SecretEntry | undefined {
    return this.secrets.find((entry) => entry.name === name);
  }

  // Add or replace by name. `entry` is assumed pre-validated by the route's
  // zod parse; the store re-sanitizes the program list (dedupe/cap) so the
  // persisted shape is canonical regardless of input order. Returns the
  // canonicalized entry, or null if adding a new name would exceed MAX_SECRETS
  // (replacing an existing name doesn't count against the cap).
  upsert(entry: SecretEntry): SecretEntry | null {
    const canonical: SecretEntry = {
      name: entry.name,
      envVar: entry.envVar,
      programs: sanitizePrograms(entry.programs),
    };
    const existingIndex = this.secrets.findIndex((item) => item.name === canonical.name);
    if (existingIndex === -1 && this.secrets.length >= MAX_SECRETS) return null;
    if (existingIndex !== -1) {
      this.secrets[existingIndex] = canonical;
    } else {
      this.secrets.push(canonical);
    }
    this.persist();
    return { ...canonical, programs: [...canonical.programs] };
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
      programs: sanitizePrograms(entry.programs),
    }));
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: SECRETS_FILE_VERSION,
      secrets: this.secrets,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
