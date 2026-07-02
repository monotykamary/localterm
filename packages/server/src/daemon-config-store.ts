import fs from "node:fs";
import path from "node:path";
import {
  DAEMON_CONFIG_FILE_VERSION,
  SESSION_GRACE_DEFAULT_SECONDS,
  SESSION_GRACE_MAX_SECONDS,
  SESSION_GRACE_MIN_SECONDS,
  TCP_PORT_MAX,
} from "./constants.js";
import { daemonConfigFileSchema } from "./schemas.js";
import type { IdentityConfig } from "./identity/types.js";

interface DaemonConfig {
  // `null` = auto-detect (scan user-data dirs for a DevToolsActivePort); a
  // number targets a specific debug endpoint via `/json/version` (e.g. Aside
  // on 52860). Stored as the single editable knob for the CDP background-tab
  // path — the daemon reads it live, so a `PUT /api/config` takes effect on
  // the next `connect()` without a restart.
  cdpPort: number | null;
  // No-clients grace window in seconds. `null` = never reap (a dormant shell
  // lingers until killed from the switcher or evicted at the session cap);
  // `0` = reap an idle shell the moment its last viewer detaches. The daemon
  // reads it live, so a `PUT /api/config` re-arms already-dormant shells.
  graceSeconds: number | null;
  // Identity provider config — scopes the session registry per authenticated
  // user. `null` = no provider (single-authority mode, byte-identical to the
  // no-auth behavior). Read once at daemon start (the provider is built from
  // it); changing it requires a restart, so unlike the two knobs above it's
  // not live-editable via `PUT /api/config`.
  identity: IdentityConfig | null;
}

const DEFAULT_CONFIG: DaemonConfig = {
  cdpPort: null,
  graceSeconds: SESSION_GRACE_DEFAULT_SECONDS,
  identity: null,
};

const clampPort = (port: number | null): number | null =>
  port === null ? null : Number.isInteger(port) && port > 0 && port <= TCP_PORT_MAX ? port : null;

// `null` stays `null` (the "never reap" sentinel, a deliberate user choice, not
// an error fallback); an out-of-range or non-integer falls back to the default
// so a bad hand-edited value never escalates an idle shell to "never reap".
const clampGraceSeconds = (seconds: number | null): number | null =>
  seconds === null
    ? null
    : Number.isInteger(seconds) &&
        seconds >= SESSION_GRACE_MIN_SECONDS &&
        seconds <= SESSION_GRACE_MAX_SECONDS
      ? seconds
      : SESSION_GRACE_DEFAULT_SECONDS;

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

  getGraceSeconds(): number | null {
    return this.config.graceSeconds;
  }

  getIdentity(): IdentityConfig | null {
    return this.config.identity;
  }

  // Returns the resolved value (clamped) and persists only on a real change.
  setGraceSeconds(seconds: number | null): number | null {
    const next = clampGraceSeconds(seconds);
    if (next === this.config.graceSeconds) return this.config.graceSeconds;
    this.config = { ...this.config, graceSeconds: next };
    this.persist();
    return this.config.graceSeconds;
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
    this.config = {
      cdpPort: parsed.data.cdpPort,
      graceSeconds: parsed.data.graceSeconds ?? SESSION_GRACE_DEFAULT_SECONDS,
      identity: parsed.data.identity ?? null,
    };
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // `identity` is omitted from the payload when null so a config that never
    // set it stays byte-identical to the pre-identity file (and to the default
    // a fresh daemon writes), keeping the persisted shape stable.
    const payload: {
      version: number;
      cdpPort: number | null;
      graceSeconds: number | null;
      identity?: IdentityConfig;
    } = {
      version: DAEMON_CONFIG_FILE_VERSION,
      cdpPort: this.config.cdpPort,
      graceSeconds: this.config.graceSeconds,
    };
    if (this.config.identity) payload.identity = this.config.identity;
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmpPath, this.filePath);
  }
}
