import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  NPM_REGISTRY_LATEST_URL,
  UPDATE_CHECK_FILE_VERSION,
  UPDATE_CHECK_HTTP_TIMEOUT_MS,
  UPDATE_CHECK_INTERVAL_MS,
} from "./constants.js";
import { compareSemver } from "./utils/semver-compare.js";

export interface UpdateStatus {
  // The version the running daemon reports (`currentVersion`).
  current: string;
  // The latest version the npm registry served, or null when the daemon
  // hasn't completed (or couldn't complete) a check yet.
  latest: string | null;
  // True only when `latest` parsed and is strictly newer than `current`.
  updateAvailable: boolean;
  // Epoch ms of the last successful fetch attempt, or null if none yet.
  checkedAt: number | null;
}

// Fetches the latest published version string for the localterm npm package.
// Returns null on any failure (non-2xx, network error, timeout, bad shape) so
// the store keeps the prior cache rather than clobbering it with garbage.
// Injectable so tests never hit the real registry.
export type LatestVersionFetcher = (url: string, timeoutMs: number) => Promise<string | null>;

const fetchLatestNpmVersion: LatestVersionFetcher = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: unknown };
    return typeof data.version === "string" && data.version.length > 0 ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const updateCheckFileSchema = z.object({
  version: z.literal(UPDATE_CHECK_FILE_VERSION),
  latestVersion: z.string().nullable(),
  checkedAt: z.number().int().nullable(),
});

interface PersistedCheck {
  version: typeof UPDATE_CHECK_FILE_VERSION;
  latestVersion: string | null;
  checkedAt: number | null;
}

export interface UpdateCheckStoreOptions {
  filePath: string;
  currentVersion: string;
  // The only side-effectful dependency — injectable so tests stay deterministic
  // and never touch the network.
  fetcher?: LatestVersionFetcher;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
  // When false, every method is a no-op and `getStatus` reports an unknown
  // shape (no `latest`, never flags an update) so a user who opted out of the
  // check via `LOCALTERM_SKIP_UPDATE_CHECK=1` is never surfaced a stale or
  // fresh update indicator. Defaults to true.
  enabled?: boolean;
}

/**
 * Owns the npm update check for the daemon's lifetime: fetches the latest
 * published version, semver-compares it to the running version, caches the
 * result in memory + on disk, and refreshes on a schedule. One check is shared
 * across every CLI banner (`/api/update-status?wait=1`) and every open browser
 * tab (the settings indicator), so the registry is hit at most once per
 * `UPDATE_CHECK_INTERVAL_MS` regardless of how many clients ask.
 *
 * Checks are serialized: concurrent `refresh()`/`getFreshStatus()` calls await
 * the single in-flight fetch rather than spawning duplicates. Every fetch is
 * bounded by `timeoutMs`; a failure leaves the prior cache untouched.
 */
export class UpdateCheckStore {
  private readonly filePath: string;
  private readonly currentVersion: string;
  private readonly fetcher: LatestVersionFetcher;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;
  private latestVersion: string | null;
  private checkedAt: number | null;
  private inFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: UpdateCheckStoreOptions) {
    this.filePath = options.filePath;
    this.currentVersion = options.currentVersion;
    this.fetcher = options.fetcher ?? fetchLatestNpmVersion;
    this.now = options.now ?? (() => Date.now());
    this.intervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? UPDATE_CHECK_HTTP_TIMEOUT_MS;
    this.enabled = options.enabled ?? true;
    this.latestVersion = null;
    this.checkedAt = null;
    if (this.enabled) this.load();
  }

  getStatus(): UpdateStatus {
    if (!this.enabled) return this.unknownStatus();
    return this.toStatus();
  }

  // Returns a fresh status, fetching first if the cache is stale (older than
  // the interval, or never populated). The CLI banner path blocks here for up
  // to one timeout; concurrent callers await the same in-flight fetch. If
  // disabled, returns the cached (or empty) status without fetching.
  async getFreshStatus(): Promise<UpdateStatus> {
    if (!this.enabled) return this.unknownStatus();
    if (this.isStale()) await this.refresh();
    return this.toStatus();
  }

  // Kicks a background refresh when the cache is stale. Never blocks; used by
  // the default `/api/update-status` path so a poll from every open tab can't
  // wedge on the registry. No-op when a fetch is already in flight, the cache
  // is fresh, or the check is disabled.
  refreshIfStaleBackground(): void {
    if (!this.enabled || !this.isStale() || this.inFlight !== null) return;
    void this.refresh();
  }

  // Starts the periodic background refresh. `unref`'d so the timer never keeps
  // the daemon alive on its own. Idempotent. A no-op when disabled.
  start(): void {
    if (!this.enabled || this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private isStale(): boolean {
    if (this.checkedAt === null) return true;
    return this.now() - this.checkedAt >= this.intervalMs;
  }

  // Fetches the latest version, updates the in-memory cache, and persists. A
  // failure (the fetcher returns null) leaves the prior cache untouched so a
  // transient registry/network error never degrades a previously-known result
  // to "unknown". Serialized: concurrent callers await the single in-flight
  // fetch and observe the same outcome.
  private async refresh(): Promise<void> {
    if (this.inFlight !== null) {
      await this.inFlight;
      return;
    }
    const work = (async () => {
      const fetched = await this.fetcher(NPM_REGISTRY_LATEST_URL, this.timeoutMs);
      if (fetched === null) return;
      this.latestVersion = fetched;
      this.checkedAt = this.now();
      this.persist();
    })();
    this.inFlight = work;
    try {
      await work;
    } finally {
      this.inFlight = null;
    }
  }

  private toStatus(): UpdateStatus {
    const latest = this.latestVersion;
    return {
      current: this.currentVersion,
      latest,
      updateAvailable: latest !== null && compareSemver(latest, this.currentVersion) > 0,
      checkedAt: this.checkedAt,
    };
  }

  private unknownStatus(): UpdateStatus {
    return {
      current: this.currentVersion,
      latest: null,
      updateAvailable: false,
      checkedAt: null,
    };
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
      console.warn(`update check file invalid; ignoring cache (${this.filePath})`);
      return;
    }
    const parsed = updateCheckFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`update check file invalid; ignoring cache (${this.filePath})`);
      return;
    }
    this.latestVersion = parsed.data.latestVersion;
    this.checkedAt = parsed.data.checkedAt;
  }

  private persist(): void {
    const payload: PersistedCheck = {
      version: UPDATE_CHECK_FILE_VERSION,
      latestVersion: this.latestVersion,
      checkedAt: this.checkedAt,
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    } catch {
      // state dir creation can fail only on a permission/path error; the cache
      // just won't persist, the in-memory copy still serves.
    }
    const tmpPath = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(tmpPath, this.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`failed to persist update check cache: ${message}`);
    }
  }
}
