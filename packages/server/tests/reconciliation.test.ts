import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  AUTOMATION_DOWNTIME_RECONCILE_CAP,
  DAEMON_HEARTBEAT_FILE_VERSION,
} from "../src/constants.js";
import { createServer, type RunningServer } from "../src/index.js";
import type { Automation, AutomationSchedule } from "../src/types.js";
import { enumerateMissedOccurrences } from "../src/utils/reconcile-downtime.js";

const automationWith = (schedule: AutomationSchedule): Automation => ({
  id: "a",
  name: "n",
  trigger: { kind: "schedule", schedule },
  cwd: os.tmpdir(),
  command: "x",
  enabled: true,
  limit: { kind: "forever" },
  closeOnFinish: false,
  runCount: 0,
  lifecycle: "active",
  runs: [],
  createdAt: 0,
  updatedAt: 0,
});

describe("enumerateMissedOccurrences", () => {
  it("enumerates every daily occurrence within the window", () => {
    const from = new Date(2026, 0, 1, 8, 0, 0).getTime();
    const now = new Date(2026, 0, 3, 10, 0, 0).getTime();
    expect(
      enumerateMissedOccurrences(automationWith({ kind: "daily", hour: 9, minute: 0 }), from, now),
    ).toEqual([
      new Date(2026, 0, 1, 9, 0, 0).getTime(),
      new Date(2026, 0, 2, 9, 0, 0).getTime(),
      new Date(2026, 0, 3, 9, 0, 0).getTime(),
    ]);
  });

  it("keeps only the most-recent cap occurrences for a frequent schedule", () => {
    const from = new Date(2026, 0, 1, 0, 0, 0).getTime();
    const now = new Date(2026, 0, 1, 1, 0, 0).getTime();
    const result = enumerateMissedOccurrences(
      automationWith({ kind: "everyNMinutes", step: 1 }),
      from,
      now,
    );
    expect(result).toHaveLength(AUTOMATION_DOWNTIME_RECONCILE_CAP);
    expect(result[result.length - 1]).toBe(new Date(2026, 0, 1, 0, 59, 0).getTime());
  });

  it("merges and sorts occurrences across a multiple-times-a-day schedule", () => {
    const from = new Date(2026, 0, 1, 0, 0, 0).getTime();
    const now = new Date(2026, 0, 2, 12, 0, 0).getTime();
    const schedule: AutomationSchedule = {
      kind: "timesOfDay",
      times: [
        { hour: 9, minute: 0 },
        { hour: 18, minute: 0 },
      ],
    };
    expect(enumerateMissedOccurrences(automationWith(schedule), from, now)).toEqual([
      new Date(2026, 0, 1, 9, 0, 0).getTime(),
      new Date(2026, 0, 1, 18, 0, 0).getTime(),
      new Date(2026, 0, 2, 9, 0, 0).getTime(),
    ]);
  });

  it("excludes occurrences at exactly now and clamps to the lookback window", () => {
    const now = new Date(2026, 0, 30, 9, 0, 0).getTime();
    // lastAliveAt a year ago — clamped to the 14-day lookback, so only the
    // recent dailies are enumerated (and the one at exactly now is excluded).
    const from = new Date(2025, 0, 1, 0, 0, 0).getTime();
    const result = enumerateMissedOccurrences(
      automationWith({ kind: "daily", hour: 9, minute: 0 }),
      from,
      now,
    );
    expect(result.length).toBeLessThanOrEqual(AUTOMATION_DOWNTIME_RECONCILE_CAP);
    expect(result.every((occurrence) => occurrence < now)).toBe(true);
  });

  it("enumerates nothing for a watch trigger", () => {
    const watch: Automation = {
      ...automationWith({ kind: "daily", hour: 9, minute: 0 }),
      trigger: { kind: "watch", recursive: true },
    };
    const from = new Date(2026, 0, 1, 8, 0, 0).getTime();
    const now = new Date(2026, 0, 3, 10, 0, 0).getTime();
    expect(enumerateMissedOccurrences(watch, from, now)).toEqual([]);
  });
});

describe("startup downtime reconciliation (integration)", () => {
  let stateDirectory: string;

  const boot = () =>
    createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
    });

  const heartbeatPath = () => path.join(stateDirectory, "daemon-heartbeat.json");
  const writeHeartbeat = (lastAliveAt: number) =>
    fs.writeFileSync(
      heartbeatPath(),
      JSON.stringify({ version: DAEMON_HEARTBEAT_FILE_VERSION, lastAliveAt }),
    );

  const api = (server: RunningServer, suffix: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${server.port}/api/automations${suffix}`, init);

  const createHourly = async (server: RunningServer) => {
    const response = await api(server, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "hourly",
        schedule: { kind: "hourly", minute: 30 },
        cwd: os.tmpdir(),
        command: "true",
      }),
    });
    return ((await response.json()) as { automation: { id: string } }).automation.id;
  };

  const listRuns = async (server: RunningServer) => {
    const body = (await (await api(server, "")).json()) as {
      automations: Array<{ runs: Array<Record<string, unknown>> }>;
    };
    return body.automations[0]?.runs ?? [];
  };

  beforeEach(() => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-reconcile-"));
  });

  afterEach(() => {
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("records skipped runs for downtime and downgrades stale launched runs", async () => {
    const first = await boot();
    const id = await createHourly(first);
    // A manual run leaves a "launched" record the dead process can't resolve.
    await api(first, `/${id}/run`, { method: "POST" });
    await first.stop();

    writeHeartbeat(Date.now() - 3 * 60 * 60 * 1000);

    const second = await boot();
    const runs = await listRuns(second);
    const skipped = runs.filter((run) => run.status === "skipped");
    expect(skipped.length).toBeGreaterThan(0);
    for (const run of skipped) {
      expect(run.startedAt).toBeNull();
      expect(run.countsTowardLimit).toBe(false);
      expect(run.trigger).toBe("schedule");
    }
    expect(runs.some((run) => run.status === "missed")).toBe(true);
    await second.stop();
  });

  it("records nothing on the first boot with no heartbeat", async () => {
    const first = await boot();
    await createHourly(first);
    await first.stop();
    fs.rmSync(heartbeatPath(), { force: true });

    const second = await boot();
    const runs = await listRuns(second);
    expect(runs.filter((run) => run.status === "skipped")).toEqual([]);
    await second.stop();
  });

  it("treats a sub-threshold gap as a clean restart", async () => {
    const first = await boot();
    await createHourly(first);
    await first.stop();
    writeHeartbeat(Date.now() - 5_000);

    const second = await boot();
    const runs = await listRuns(second);
    expect(runs.filter((run) => run.status === "skipped")).toEqual([]);
    await second.stop();
  });
});
