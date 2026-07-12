import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { UpdateCheckStore, type LatestVersionFetcher } from "../src/update-check-store.js";
import { UPDATE_CHECK_FILE_VERSION, UPDATE_CHECK_INTERVAL_MS } from "../src/constants.js";

describe("UpdateCheckStore", () => {
  let stateDirectory: string;
  let filePath: string;
  let nowMs: number;

  beforeEach(() => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-update-"));
    filePath = path.join(stateDirectory, "update-check.json");
    nowMs = 1_000_000;
  });

  afterEach(() => {
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const createStore = (
    overrides: {
      currentVersion?: string;
      fetcher?: LatestVersionFetcher;
      enabled?: boolean;
      intervalMs?: number;
    } = {},
  ) =>
    new UpdateCheckStore({
      filePath,
      currentVersion: overrides.currentVersion ?? "1.0.0",
      fetcher: overrides.fetcher ?? (async () => null),
      now: () => nowMs,
      intervalMs: overrides.intervalMs ?? UPDATE_CHECK_INTERVAL_MS,
      enabled: overrides.enabled,
    });

  it("reports an unknown status (no latest, no update) before any check", () => {
    const store = createStore();
    expect(store.getStatus()).toEqual({
      current: "1.0.0",
      latest: null,
      updateAvailable: false,
      checkedAt: null,
    });
  });

  it("fetches, compares, caches, and persists the latest version", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "1.2.0");
    const store = createStore({ currentVersion: "1.0.0", fetcher });
    const status = await store.getFreshStatus();
    expect(status).toEqual({
      current: "1.0.0",
      latest: "1.2.0",
      updateAvailable: true,
      checkedAt: nowMs,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      version: UPDATE_CHECK_FILE_VERSION,
      latestVersion: "1.2.0",
      checkedAt: nowMs,
    });
  });

  it("re-reads the persisted cache across instances without refetching", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "2.0.0");
    const first = createStore({ currentVersion: "1.0.0", fetcher });
    await first.getFreshStatus();
    const recreate = createStore({ currentVersion: "1.0.0", fetcher });
    expect(recreate.getStatus().latest).toBe("2.0.0");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns the fresh cache without fetching when it is not stale", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "1.1.0");
    const store = createStore({ currentVersion: "1.1.0", fetcher });
    await store.getFreshStatus();
    nowMs += 1_000;
    await store.getFreshStatus();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches once the cache crosses the interval", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "1.1.0");
    const store = createStore({
      currentVersion: "1.1.0",
      fetcher,
      intervalMs: 1_000,
    });
    await store.getFreshStatus();
    nowMs += 1_001;
    await store.getFreshStatus();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("leaves the prior cache untouched when a fetch fails", async () => {
    const good: LatestVersionFetcher = vi.fn(async () => "1.5.0");
    const store = createStore({ currentVersion: "1.0.0", fetcher: good, intervalMs: 1_000 });
    await store.getFreshStatus();
    const failed: LatestVersionFetcher = vi.fn(async () => null);
    const broken = new UpdateCheckStore({
      filePath,
      currentVersion: "1.0.0",
      fetcher: failed,
      now: () => nowMs,
      intervalMs: 1_000,
    });
    nowMs += 2_000;
    const status = await broken.getFreshStatus();
    expect(status.latest).toBe("1.5.0");
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent fetches into a single registry call", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "1.2.0");
    const store = createStore({ currentVersion: "1.0.0", fetcher });
    await Promise.all([store.getFreshStatus(), store.getFreshStatus(), store.getFreshStatus()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not flag an update when the registry version is not newer", async () => {
    const store = createStore({
      currentVersion: "2.0.0",
      fetcher: async () => "2.0.0",
    });
    const status = await store.getFreshStatus();
    expect(status.updateAvailable).toBe(false);
  });

  it("parses a v-prefixed registry version before comparing", async () => {
    const store = createStore({
      currentVersion: "v1.9.0",
      fetcher: async () => "v2.0.0",
    });
    const status = await store.getFreshStatus();
    expect(status.updateAvailable).toBe(true);
  });

  it("treats an unparseable registry response as 'not newer'", async () => {
    const store = createStore({
      currentVersion: "1.0.0",
      fetcher: async () => "not-a-version",
    });
    const status = await store.getFreshStatus();
    expect(status.updateAvailable).toBe(false);
    expect(status.latest).toBe("not-a-version");
  });

  it("ignores a corrupt cache file and falls back to an unknown status", () => {
    fs.writeFileSync(filePath, "{ not json");
    const store = createStore();
    expect(store.getStatus().latest).toBeNull();
  });

  it("never fetches and always reports unknown when disabled", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "9.9.9");
    const store = createStore({ currentVersion: "1.0.0", fetcher, enabled: false });
    expect(store.getStatus()).toEqual({
      current: "1.0.0",
      latest: null,
      updateAvailable: false,
      checkedAt: null,
    });
    const fresh = await store.getFreshStatus();
    expect(fresh.updateAvailable).toBe(false);
    expect(fresh.latest).toBeNull();
    store.refreshIfStaleBackground();
    store.start();
    expect(fetcher).not.toHaveBeenCalled();
    store.dispose();
  });
});
