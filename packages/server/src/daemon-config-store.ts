import fs from "node:fs";
import path from "node:path";
import { DAEMON_CONFIG_FILE_VERSION, TCP_PORT_MAX } from "./constants.js";
import { daemonConfigFileSchema } from "./schemas.js";

interface DaemonConfig {
  // `null` = auto-detect (scan user-data dirs for a DevToolsActivePort); a
  // number targets a specific debug endpoint via `/json/version` (e.g. Aside
  // on 52860). Stored as the single editable knob for the CDP background-tab
  // path — the daemon reads it live, so a `PUT /api/config` takes effect on
  // the next `connect()` without a restart.
  cdpPort: number | null;
}

const DEFAULT_CONFIG: DaemonConfig = { cdpPort: null };

const clampPort = (port: number | null): number | null =>
  port === null
    ? null
    : Number.isInteger(port) && port > 0 && port <= TCP_PORT_MAX
      ? port
      : null;

// Owns the persisted daemon config (~/.localterm/config.json). Mirrors the
// caffeinate preferences store: zod-validated read, atomic tmp+rename write,
// graceful fallback to defaults on a missing/corrupt file.
export class DaemonConfigStore {
  private config: DaemonConfig = { ...DEFAULT_CONFIG };

  constructor(private readonly filePath: string) {
    this.load();
  }

  getCdpPort(): number | null {
    return this.config.cdpPort;
  }

  // Returns the resolved port (clamped, `null` for an out-of-range input so a
  // bad value never reaches detection) and persists only on a real change.
  setCdpPort(port: number | null): number | null {
    const next = clampPort(port);
    if (next === this.config.cdpPort) return this.config.cdpPort;
    this.config = { ...this.config, cdpPort: next };
    this.persist();
    return this.config.cdpPort;
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
      console.warn(`daemon config file invalid; using defaults (${this.filePath})`);
      return;
    }
    const parsed = daemonConfigFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`daemon config file invalid; using defaults (${this.filePath})`);
      return;
    }
    this.config = { cdpPort: parsed.data.cdpPort };
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: DAEMON_CONFIG_FILE_VERSION,
      cdpPort: this.config.cdpPort,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
