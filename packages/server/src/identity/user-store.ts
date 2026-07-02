import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

interface StoredUser {
  username: string;
  credentialIds: string[];
}

const usersFileSchema = z.object({
  version: z.literal(1).optional(),
  users: z.record(z.string(), z.object({ username: z.string(), credentialIds: z.array(z.string()) })),
});

// File-backed registry of passkey users (~/.localterm/users.json): username →
// the credential ids that authenticate them. Holds no key material (that's the
// credential store); this just answers "which credentials belong to this user"
// for registration exclude-lists and login allow-lists. Atomic tmp+rename write,
// graceful fallback to empty on a missing/corrupt file.
export class UserStore {
  private readonly users = new Map<string, StoredUser>();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  get(username: string): StoredUser | null {
    const user = this.users.get(username);
    return user ? { ...user, credentialIds: [...user.credentialIds] } : null;
  }

  findOrCreate(username: string): StoredUser {
    let user = this.users.get(username);
    if (!user) {
      user = { username, credentialIds: [] };
      this.users.set(username, user);
      this.persist();
    }
    return { ...user, credentialIds: [...user.credentialIds] };
  }

  addCredential(username: string, credentialId: string): void {
    const user = this.users.get(username);
    if (!user || user.credentialIds.includes(credentialId)) return;
    user.credentialIds.push(credentialId);
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
      console.warn(`users file invalid; ignoring (${this.filePath})`);
      return;
    }
    const parsed = usersFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`users file invalid; ignoring (${this.filePath})`);
      return;
    }
    this.users.clear();
    for (const [username, user] of Object.entries(parsed.data.users)) {
      this.users.set(username, { username: user.username, credentialIds: [...user.credentialIds] });
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: 1,
      users: Object.fromEntries(this.users.entries()),
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
