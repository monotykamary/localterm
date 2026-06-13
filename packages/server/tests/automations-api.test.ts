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
      tabController: {
        open: async (url) => {
          openedUrls.push(url);
          return null;
        },
        close: async () => {},
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

  it("creates with a structured schedule and exposes derived cron + empty history", async () => {
    const { status, body } = await request("POST", "", {
      name: "weekday standup",
      schedule: { kind: "weekdaysPreset", preset: "weekdays", hour: 9, minute: 0 },
      cwd: os.tmpdir(),
      command: "echo standup",
    });
    expect(status).toBe(201);
    const automation = automationWithNextRunSchema.parse(body.automation);
    expect(automation.schedule).toEqual({
      kind: "weekdaysPreset",
      preset: "weekdays",
      hour: 9,
      minute: 0,
    });
    expect(automation.cron).toBe("0 9 * * 1-5");
    expect(automation.runs).toEqual([]);
    expect(automation.lastRun).toBeNull();
    expect(automation.limit).toEqual({ kind: "forever" });
    expect(automation.lifecycle).toBe("active");
  });

  it("accepts a legacy bare cron string and recognizes it as a preset", async () => {
    const { body } = await request("POST", "", { ...createInput(), schedule: "0 9 * * 1-5" });
    const automation = automationWithNextRunSchema.parse(body.automation);
    expect(automation.schedule).toEqual({
      kind: "weekdaysPreset",
      preset: "weekdays",
      hour: 9,
      minute: 0,
    });
  });

  it("rejects a structured schedule that cannot compile to valid cron", async () => {
    const { body } = await request("POST", "", {
      ...createInput(),
      schedule: { kind: "cron", expression: "totally invalid" },
    });
    expect(body.error).toBe("invalid_schedule");
  });

  it("does not count manual runs toward the limit", async () => {
    const created = await request("POST", "", {
      ...createInput(),
      limit: { kind: "count", max: 2 },
    });
    const automation = automationWithNextRunSchema.parse(created.body.automation);
    await request("POST", `/${automation.id}/run`);
    await request("POST", `/${automation.id}/run`);
    await request("POST", `/${automation.id}/run`);
    const [listed] = (await request("GET", "")).body.automations as Array<Record<string, unknown>>;
    expect(listed.runCount).toBe(0);
    expect(listed.lifecycle).toBe("active");
    const runs = listed.runs as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.trigger === "manual" && run.countsTowardLimit === false)).toBe(
      true,
    );
  });

  it("reset reactivates and can clear history", async () => {
    const created = await request("POST", "", createInput());
    const automation = automationWithNextRunSchema.parse(created.body.automation);
    await request("POST", `/${automation.id}/run`);
    const reset = await request("POST", `/${automation.id}/reset`, { clearHistory: true });
    expect(reset.status).toBe(200);
    const afterReset = automationWithNextRunSchema.parse(reset.body.automation);
    expect(afterReset.lifecycle).toBe("active");
    expect(afterReset.runs).toEqual([]);
    expect((await request("POST", "/missing/reset")).status).toBe(404);
  });

  it("blocks re-enabling a finished automation until it is reset", async () => {
    // Pre-seed a finished automation, then boot a fresh server over it so the
    // finished-state route logic can be exercised without waiting on a tick.
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-finished-"));
    fs.writeFileSync(
      path.join(seedDir, "automations.json"),
      JSON.stringify({
        version: 2,
        automations: [
          {
            id: "fin-1",
            name: "done",
            schedule: { kind: "daily", hour: 9, minute: 0 },
            cwd: os.tmpdir(),
            command: "true",
            enabled: true,
            limit: { kind: "count", max: 1 },
            runCount: 1,
            lifecycle: "finished",
            runs: [],
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    );
    const server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory: seedDir,
      tabController: { open: async () => null, close: async () => {} },
    });
    try {
      const base = `http://127.0.0.1:${server.port}/api/automations`;
      const reEnable = await (
        await fetch(`${base}/fin-1`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        })
      ).json();
      expect((reEnable as Record<string, unknown>).error).toBe("automation_finished");
      // A finished automation reports no next run.
      const listed = (await (await fetch(base)).json()) as {
        automations: Array<{ lifecycle: string; nextRunAt: number | null }>;
      };
      expect(listed.automations[0].lifecycle).toBe("finished");
      expect(listed.automations[0].nextRunAt).toBeNull();
      const reset = (await (await fetch(`${base}/fin-1/reset`, { method: "POST" })).json()) as {
        automation: { lifecycle: string; runCount: number };
      };
      expect(reset.automation.lifecycle).toBe("active");
      expect(reset.automation.runCount).toBe(0);
    } finally {
      await server.stop();
      fs.rmSync(seedDir, { recursive: true, force: true });
    }
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

  it("closes the run tab when closeOnFinish is set and the command finishes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-close-"));
    const closedHandles: string[] = [];
    // A tab controller that hands back a closeable handle and records closes.
    const server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory: dir,
      tabController: {
        open: async () => "tab-handle-1",
        close: async (handle) => {
          closedHandles.push(handle);
        },
      },
    });
    try {
      const base = `http://127.0.0.1:${server.port}/api/automations`;
      const post = async (suffix: string, body?: unknown) =>
        (
          await fetch(`${base}${suffix}`, {
            method: "POST",
            ...(body
              ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
              : {}),
          })
        ).json();

      const created = (await post("", {
        name: "closer",
        schedule: "0 2 * * *",
        cwd: dir,
        command: "echo automation-ran-marker",
        closeOnFinish: true,
      })) as { automation: { id: string } };
      const run = (await post(`/${created.automation.id}/run`)) as { runId: string };

      // Claim the run in a real session; the command runs and exits, which fires
      // automation-exit and should close the tab via the controller.
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?run=${run.runId}`);
      try {
        await vi.waitFor(() => expect(closedHandles).toEqual(["tab-handle-1"]), {
          timeout: 30_000,
          interval: 100,
        });
      } finally {
        socket.close();
        await new Promise<void>((resolve) => socket.once("close", () => resolve()));
      }
    } finally {
      await server.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("leaves the run tab open when closeOnFinish is not set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-noclose-"));
    const closedHandles: string[] = [];
    const server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory: dir,
      tabController: {
        open: async () => "tab-handle-1",
        close: async (handle) => {
          closedHandles.push(handle);
        },
      },
    });
    try {
      const base = `http://127.0.0.1:${server.port}/api/automations`;
      const created = (await (
        await fetch(base, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "no-closer",
            schedule: "0 2 * * *",
            cwd: dir,
            command: "echo automation-ran-marker",
          }),
        })
      ).json()) as { automation: { id: string } };
      const run = (await (
        await fetch(`${base}/${created.automation.id}/run`, { method: "POST" })
      ).json()) as { runId: string };

      const collected: string[] = [];
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?run=${run.runId}`);
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message.type === "output" && typeof message.data === "string") {
            collected.push(message.data);
          }
        } catch {
          /* ignore */
        }
      });
      try {
        // Wait until the command has clearly run, then confirm no close happened.
        await vi.waitFor(() => expect(collected.join("")).toContain("automation-ran-marker"), {
          timeout: 30_000,
          interval: 100,
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(closedHandles).toEqual([]);
      } finally {
        socket.close();
        await new Promise<void>((resolve) => socket.once("close", () => resolve()));
      }
    } finally {
      await server.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
