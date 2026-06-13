import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DAEMON_HEARTBEAT_FILE_VERSION } from "./constants.js";

// A tiny sibling of automations.json (~/.localterm/daemon-heartbeat.json). The
// scheduler stamps `lastAliveAt` here every minute; on the next boot the gap
// between this timestamp and "now" is the downtime window used to reconstruct
// "skipped" runs. It lives in its own file so the per-minute write never
// rewrites (or races) the much larger automations history file.
const heartbeatFileSchema = z
  .object({
    version: z.literal(DAEMON_HEARTBEAT_FILE_VERSION),
    lastAliveAt: z.number().int().nonnegative(),
  })
  .strict();

export class HeartbeatStore {
  constructor(private readonly filePath: string) {}

  read(): number | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = heartbeatFileSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data.lastAliveAt : null;
    } catch {
      return null;
    }
  }

  write(lastAliveAt: number): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = { version: DAEMON_HEARTBEAT_FILE_VERSION, lastAliveAt };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
