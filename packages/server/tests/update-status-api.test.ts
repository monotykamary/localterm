import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";
import type { LatestVersionFetcher } from "../src/update-check-store.js";

describe("/api/update-status", () => {
  let stateDirectory: string;
  let server: RunningServer;

  beforeEach(async () => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-update-api-"));
  });

  afterEach(async () => {
    await server?.stop();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  const startServer = (
    overrides: {
      currentVersion?: string;
      fetcher?: LatestVersionFetcher;
    } = {},
  ) =>
    createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      currentVersion: overrides.currentVersion ?? "1.0.0",
      updateCheckFetcher: overrides.fetcher ?? (async () => null),
      tabController: { open: async () => null, close: async () => {} },
    });

  const url = (wait?: boolean) =>
    `http://127.0.0.1:${server.port}/api/update-status${wait ? "?wait=1" : ""}`;

  it("reports the running version before any check resolves", async () => {
    // A slow fetcher that never resolves within the test: the default
    // (non-waiting) route returns the cached unknown status immediately.
    const fetcher: LatestVersionFetcher = vi.fn(async () => new Promise<string | null>(() => {}));
    server = await startServer({ currentVersion: "1.0.0", fetcher });
    const response = await fetch(url());
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toMatchObject({
      current: "1.0.0",
      updateAvailable: false,
    });
    expect(body.latest).toBeNull();
  });

  it("waits for a fresh fetch with ?wait=1 and flags an available update", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "1.4.0");
    server = await startServer({ currentVersion: "1.0.0", fetcher });
    const response = await fetch(url(true));
    const body = await response.json();
    expect(body).toMatchObject({
      current: "1.0.0",
      latest: "1.4.0",
      updateAvailable: true,
    });
    expect(typeof body.checkedAt).toBe("number");
  });

  it("does not flag an update when already on the latest", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "1.0.0");
    server = await startServer({ currentVersion: "1.0.0", fetcher });
    const body = await (await fetch(url(true))).json();
    expect(body).toMatchObject({
      latest: "1.0.0",
      updateAvailable: false,
    });
  });

  it("serves the cached result without a blocking refetch on the default path", async () => {
    const fetcher: LatestVersionFetcher = vi.fn(async () => "2.0.0");
    server = await startServer({ currentVersion: "1.0.0", fetcher });
    // Prime the cache via the blocking path.
    await fetch(url(true));
    const callsBefore = fetcher.mock.calls.length;
    const body = await (await fetch(url())).json();
    expect(body.latest).toBe("2.0.0");
    expect(fetcher.mock.calls.length).toBe(callsBefore);
  });
});
