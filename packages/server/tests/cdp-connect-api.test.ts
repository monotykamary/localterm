import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";

describe("/api/cdp/connect", () => {
  let stateDirectory: string;
  let server: RunningServer;

  beforeEach(async () => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-cdp-connect-"));
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("surfaces the connect error when no browser is reachable", async () => {
    // No tabController → cdpClient is live; inject an empty detect so connect()
    // fails fast with a deterministic reason instead of scanning real user-data dirs.
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      cdpDetect: async () => [],
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/api/cdp/connect`, {
      method: "POST",
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { connected: boolean; error?: string };
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/no debug-enabled Chromium browser detected/);
  });

  it("reports CDP disabled when a tabController owns tab control", async () => {
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/api/cdp/connect`, {
      method: "POST",
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { connected: boolean; error?: string };
    expect(body.connected).toBe(false);
    expect(body.error).toBe("CDP disabled");
  });
});
