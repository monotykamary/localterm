import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// The key material needed to verify a later login assertion. `publicKey` is the
// COSE public key bytes from registration, stored base64 (the file is JSON);
// reconstructed to a Uint8Array for `verifyAuthenticationResponse`. `counter`
// is updated on each login to detect cloned authenticators.
interface StoredCredential {
  id: string;
  publicKey: string;
  counter: number;
  username: string;
}

const credentialsFileSchema = z.object({
  version: z.literal(1).optional(),
  credentials: z.record(
    z.string(),
    z.object({
      id: z.string(),
      publicKey: z.string(),
      counter: z.number().int().nonnegative(),
      username: z.string(),
    }),
  ),
});

// File-backed registry of passkey credentials (~/.localterm/credentials.json):
// credential id → { publicKey, counter, username }. The login verify path looks
// up the credential by the assertion's `id`, reconstructs it for simplewebauthn,
// and updates the replay-protection counter on success. Atomic tmp+rename
// write, graceful fallback to empty on a missing/corrupt file.
export class CredentialStore {
  private readonly credentials = new Map<string, StoredCredential>();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  get(id: string): StoredCredential | null {
    return this.credentials.get(id) ?? null;
  }

  put(credential: StoredCredential): void {
    this.credentials.set(credential.id, credential);
    this.persist();
  }

  updateCounter(id: string, counter: number): void {
    const credential = this.credentials.get(id);
    if (!credential) return;
    credential.counter = counter;
    this.persist();
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
      console.warn(`credentials file invalid; ignoring (${this.filePath})`);
      return;
    }
    const parsed = credentialsFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`credentials file invalid; ignoring (${this.filePath})`);
      return;
    }
    this.credentials.clear();
    for (const [id, credential] of Object.entries(parsed.data.credentials)) {
      this.credentials.set(id, { ...credential });
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: 1,
      credentials: Object.fromEntries(this.credentials.entries()),
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
