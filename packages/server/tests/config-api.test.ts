import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";
import { SESSION_GRACE_DEFAULT_SECONDS } from "../src/constants.js";

describe("/api/config", () => {
  let stateDirectory: string;
  let server: RunningServer;

  beforeEach(async () => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-config-api-"));
    // Inject a no-op tab controller so the server doesn't reach for a real CDP
    // browser; applyCdpPort is a pure config write (persist + update the live
    // port value) and never touches the socket.
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
    });
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  const configUrl = () => `http://127.0.0.1:${server.port}/api/config`;

  // The response also carries the host's detected `defaultShell` and `shells`
  // list, but those are environment-dependent (the test host's getDefaultShell
  // + /etc/shells), so each assertion below only pins the config knobs via
  // toMatchObject and separately checks the shell fields are present and
  // internally consistent (shells always includes the detected default).
  const expectShellFields = (body: Record<string, unknown>): void => {
    expect(typeof body.defaultShell).toBe("string");
    expect((body.defaultShell as string).length).toBeGreaterThan(0);
    expect(Array.isArray(body.shells)).toBe(true);
    expect(body.shells).toContain(body.defaultShell);
  };

  it("GET returns a null cdpPort by default (auto-detect)", async () => {
    const response = await fetch(configUrl());
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toMatchObject({ cdpPort: null, graceSeconds: SESSION_GRACE_DEFAULT_SECONDS });
    expectShellFields(body);
  });

  it("PUT persists a configured port and echoes it back", async () => {
    const response = await fetch(configUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cdpPort: 52860 }),
    });
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toMatchObject({ cdpPort: 52860, graceSeconds: SESSION_GRACE_DEFAULT_SECONDS });
    expectShellFields(body);

    const reloaded = JSON.parse(fs.readFileSync(path.join(stateDirectory, "config.json"), "utf8"));
    expect(reloaded.cdpPort).toBe(52860);

    const reget = await (await fetch(configUrl())).json();
    expect(reget).toMatchObject({ cdpPort: 52860, graceSeconds: SESSION_GRACE_DEFAULT_SECONDS });
    expectShellFields(reget);
  });

  it("PUT with null clears the override back to auto-detect", async () => {
    await fetch(configUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cdpPort: 52860 }),
    });
    const response = await fetch(configUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cdpPort: null }),
    });
    const body = await response.json();
    expect(body).toMatchObject({ cdpPort: null, graceSeconds: SESSION_GRACE_DEFAULT_SECONDS });
    expectShellFields(body);
  });

  it("PUT rejects an out-of-range port with 400", async () => {
    const response = await fetch(configUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cdpPort: 70000 }),
    });
    expect(response.status).toBe(400);
    // The override is unchanged.
    expect(await (await fetch(configUrl())).json()).toMatchObject({
      cdpPort: null,
      graceSeconds: SESSION_GRACE_DEFAULT_SECONDS,
    });
  });

  it("PUT rejects an invalid body with 400", async () => {
    const response = await fetch(configUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cdpPort: "not-a-port" }),
    });
    expect(response.status).toBe(400);
  });
});
