import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WebSocket } from "ws";
import { createServer, type RunningServer } from "../src/index.js";
import { WS_CLOSE_SPAWN_FAILED } from "../src/constants.js";
import { SessionSpawnError } from "../src/session-spawn-error.js";

vi.mock("../src/pty-backend.js", () => ({
  spawnPty: () => {
    throw new Error("posix_spawnp failed: ENXIO");
  },
}));
vi.mock("../src/ensure-spawn-helper-executable.js", () => ({
  ensureSpawnHelperExecutable: vi.fn(),
}));
vi.mock("../src/shell-hook-builder.js", () => ({
  ShellHookBuilder: class {
    hookCleanupPaths: string[] = [];
    prepare() {
      return [[], null];
    }
  },
}));

describe("spawn failure responses", { tags: ["integration"] }, () => {
  let directory: string;
  let server: RunningServer;
  const openedUrls: string[] = [];
  const post = (suffix: string, body: unknown) =>
    fetch(`http://127.0.0.1:${server.port}/api${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const connect = (suffix = "/ws") =>
    new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}${suffix}`);
      socket.once("error", reject);
      socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-spawn-api-"));
    openedUrls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory: directory,
      tabController: {
        open: async (url) => {
          openedUrls.push(url);
          return null;
        },
        close: async () => {},
      },
    });
  });
  afterEach(async () => {
    await server?.stop();
    fs.rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each(["/sessions", "/exec"])(
    "returns an explicit 503 from %s without registering a shell",
    async (route) => {
      const response = await post(route, { shell: "/bin/sh", command: "true" });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "spawn_failed",
        message: new SessionSpawnError(null).message,
      });
      expect(server.registry.size()).toBe(0);
    },
  );

  it("closes a failed WebSocket startup with a visible reason while health stays available", async () => {
    expect(await connect("/ws?shell=/bin/sh")).toEqual({
      code: WS_CLOSE_SPAWN_FAILED,
      reason: new SessionSpawnError(null).message,
    });
    const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(await health.json()).toMatchObject({ ok: true, sessions: 0 });
  });

  it("finishes a claimed automation as failed instead of leaving it launched forever", async () => {
    const created = await post("/automations", {
      name: "spawn failure",
      cwd: directory,
      enabled: false,
      trigger: { kind: "schedule", schedule: "0 2 * * *" },
      runner: { kind: "shell", command: "true" },
    });
    expect(created.status).toBe(201);
    const { automation } = await created.json();
    const response = await post(`/automations/${automation.id}/run`, {});
    expect(response.ok).toBe(true);
    expect(openedUrls).toHaveLength(1);
    const url = new URL(openedUrls[0]!);
    expect((await connect(`/ws${url.search}`)).code).toBe(WS_CLOSE_SPAWN_FAILED);
    const runs = server.automationStore.get(automation.id)?.runs;
    expect(runs).toHaveLength(1);
    expect(runs?.[0]).toMatchObject({ status: "failed", finishedAt: expect.any(Number) });
  });
});
