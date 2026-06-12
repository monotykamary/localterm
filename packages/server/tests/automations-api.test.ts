import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WebSocket } from "ws";
import { createServer, type RunningServer } from "../src/index.js";
import { automationWithNextRunSchema } from "../src/schemas.js";

interface TestContext {
  server: RunningServer;
  stateDirectory: string;
  openedUrls: string[];
}

const createInput = () => ({
  name: "nightly build",
  schedule: "0 2 * * *",
  cwd: os.tmpdir(),
  command: "pnpm build",
});

describe("automations REST API", () => {
  let testContext: TestContext;

  const apiUrl = (suffix: string) =>
    `http://127.0.0.1:${testContext.server.port}/api/automations${suffix}`;

  const request = async (method: string, suffix: string, body?: unknown) => {
    const response = await fetch(apiUrl(suffix), {
      method,
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  beforeEach(async () => {
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-api-"));
    const openedUrls: string[] = [];
    const server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      openUrl: async (url) => {
        openedUrls.push(url);
      },
    });
    testContext = { server, stateDirectory, openedUrls };
  });

  afterEach(async () => {
    await testContext.server.stop();
    fs.rmSync(testContext.stateDirectory, { recursive: true, force: true });
  });

  it("lists an empty set of automations", async () => {
    const { status, body } = await request("GET", "");
    expect(status).toBe(200);
    expect(body).toEqual({ automations: [] });
  });

  it("creates an automation and returns it with a computed next run", async () => {
    const { status, body } = await request("POST", "", createInput());
    expect(status).toBe(201);
    const automation = automationWithNextRunSchema.parse(body.automation);
    expect(automation.name).toBe("nightly build");
    expect(automation.enabled).toBe(true);
    expect(automation.nextRunAt).toBeGreaterThan(Date.now());

    const listed = await request("GET", "");
    expect(listed.body.automations).toHaveLength(1);
  });

  it("persists automations to the state directory", async () => {
    await request("POST", "", createInput());
    const persisted = JSON.parse(
      fs.readFileSync(path.join(testContext.stateDirectory, "automations.json"), "utf8"),
    );
    expect(persisted.automations).toHaveLength(1);
  });

  it("rejects invalid bodies, schedules, and directories", async () => {
    expect((await request("POST", "", { nope: true })).status).toBe(400);
    expect((await request("POST", "", { ...createInput(), schedule: "bad" })).body.error).toBe(
      "invalid_schedule",
    );
    expect(
      (await request("POST", "", { ...createInput(), cwd: "/definitely/not/a/dir" })).body.error,
    ).toBe("invalid_cwd");
  });

  it("updates an automation", async () => {
    const created = await request("POST", "", createInput());
    const automation = automationWithNextRunSchema.parse(created.body.automation);
    const { status, body } = await request("PATCH", `/${automation.id}`, { enabled: false });
    expect(status).toBe(200);
    const updated = automationWithNextRunSchema.parse(body.automation);
    expect(updated.enabled).toBe(false);
    expect(updated.nextRunAt).toBeNull();
  });

  it("rejects updates with invalid fields and unknown ids", async () => {
    const created = await request("POST", "", createInput());
    const automation = automationWithNextRunSchema.parse(created.body.automation);
    expect((await request("PATCH", `/${automation.id}`, { schedule: "bad" })).body.error).toBe(
      "invalid_schedule",
    );
    expect((await request("PATCH", "/missing", { enabled: false })).status).toBe(404);
  });

  it("deletes an automation", async () => {
    const created = await request("POST", "", createInput());
    const automation = automationWithNextRunSchema.parse(created.body.automation);
    expect((await request("DELETE", `/${automation.id}`)).status).toBe(200);
    expect((await request("DELETE", `/${automation.id}`)).status).toBe(404);
    expect((await request("GET", "")).body.automations).toEqual([]);
  });

  it("launches a run-now request by opening a tab url with the run id", async () => {
    const created = await request("POST", "", createInput());
    const automation = automationWithNextRunSchema.parse(created.body.automation);
    const { status, body } = await request("POST", `/${automation.id}/run`);
    expect(status).toBe(200);
    expect(typeof body.runId).toBe("string");
    expect(testContext.openedUrls).toHaveLength(1);
    expect(testContext.openedUrls[0]).toBe(
      `http://localterm.localhost:${testContext.server.port}/?run=${body.runId}`,
    );

    const listed = await request("GET", "");
    const [withLastRun] = listed.body.automations as Array<Record<string, unknown>>;
    expect(withLastRun.lastRun).toMatchObject({ status: "launched", runId: body.runId });
  });

  it("returns 404 when running an unknown automation", async () => {
    expect((await request("POST", "/missing/run")).status).toBe(404);
  });

  it("lets a tab claim a run exactly once and runs the command in the automation cwd", async () => {
    const automationCwd = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-run-cwd-"));
    try {
      const created = await request("POST", "", {
        name: "marker",
        schedule: "0 2 * * *",
        cwd: automationCwd,
        command: "echo automation-ran-marker",
      });
      const automation = automationWithNextRunSchema.parse(created.body.automation);
      const run = await request("POST", `/${automation.id}/run`);
      const runId = run.body.runId;
      expect(typeof runId).toBe("string");

      const collected: string[] = [];
      let sessionCwd: string | null = null;
      const socket = new WebSocket(
        `ws://127.0.0.1:${testContext.server.port}/ws?run=${String(runId)}`,
      );
      socket.addEventListener("message", (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== "object") return;
        const message = parsed as Record<string, unknown>;
        if (message.type === "session" && typeof message.cwd === "string") {
          sessionCwd = message.cwd;
        }
        if (message.type === "output" && typeof message.data === "string") {
          collected.push(message.data);
        }
      });

      await vi.waitFor(
        () => {
          expect(sessionCwd).toBe(automationCwd);
          expect(collected.join("")).toContain("automation-ran-marker");
        },
        { timeout: 30_000, interval: 100 },
      );

      const listed = await request("GET", "");
      const [withLastRun] = listed.body.automations as Array<Record<string, unknown>>;
      expect(withLastRun.lastRun).toMatchObject({ runId });
      const claimedStatus = (withLastRun.lastRun as Record<string, unknown>).status;
      // "completed" is reachable when the shell's exit-report hook already
      // fired between the marker output and this request.
      expect(["running", "completed"]).toContain(claimedStatus);

      socket.close();
      await new Promise<void>((resolve) => socket.once("close", () => resolve()));

      const secondSocket = new WebSocket(
        `ws://127.0.0.1:${testContext.server.port}/ws?run=${String(runId)}`,
      );
      const secondOutputs: string[] = [];
      secondSocket.addEventListener("message", (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== "object") return;
        const message = parsed as Record<string, unknown>;
        if (message.type === "session") secondOutputs.push("session");
        if (message.type === "output" && typeof message.data === "string") {
          secondOutputs.push(message.data);
        }
      });
      await vi.waitFor(
        () => {
          expect(secondOutputs).toContain("session");
        },
        { timeout: 30_000, interval: 100 },
      );
      // The claim was consumed, so a reload only gets a plain shell: give any
      // buffered output a moment to arrive, then assert the command never ran.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(secondOutputs.join("")).not.toContain("echo automation-ran-marker");
      secondSocket.close();
      await new Promise<void>((resolve) => secondSocket.once("close", () => resolve()));
    } finally {
      fs.rmSync(automationCwd, { recursive: true, force: true });
    }
  }, 90_000);
});
