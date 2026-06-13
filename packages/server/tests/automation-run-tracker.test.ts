import { describe, expect, it } from "vite-plus/test";
import { AutomationRunTracker } from "../src/automation-run-tracker.js";
import { AUTOMATION_PENDING_RUN_EXPIRY_MS } from "../src/constants.js";
import type { Automation } from "../src/types.js";

const automation: Automation = {
  id: "automation-1",
  name: "nightly build",
  schedule: { kind: "daily", hour: 2, minute: 0 },
  cwd: "/tmp",
  command: "pnpm build",
  enabled: true,
  limit: { kind: "forever" },
  runCount: 0,
  lifecycle: "active",
  runs: [],
  createdAt: 0,
  updatedAt: 0,
};

describe("AutomationRunTracker", () => {
  it("creates pending runs with a snapshot of the automation", () => {
    const tracker = new AutomationRunTracker();
    const run = tracker.create(automation, 1000);
    expect(run.automationId).toBe(automation.id);
    expect(run.cwd).toBe(automation.cwd);
    expect(run.command).toBe(automation.command);
    expect(run.createdAt).toBe(1000);
    expect(tracker.size()).toBe(1);
  });

  it("claims a run exactly once", () => {
    const tracker = new AutomationRunTracker();
    const run = tracker.create(automation);
    expect(tracker.claim(run.runId)).toEqual(run);
    expect(tracker.claim(run.runId)).toBeNull();
    expect(tracker.size()).toBe(0);
  });

  it("returns null for unknown run ids", () => {
    const tracker = new AutomationRunTracker();
    expect(tracker.claim("missing")).toBeNull();
  });

  it("sweeps only expired runs", () => {
    const tracker = new AutomationRunTracker();
    const oldRun = tracker.create(automation, 0);
    const freshRun = tracker.create(automation, AUTOMATION_PENDING_RUN_EXPIRY_MS - 1);
    const expired = tracker.sweepExpired(AUTOMATION_PENDING_RUN_EXPIRY_MS);
    expect(expired).toEqual([oldRun]);
    expect(tracker.claim(freshRun.runId)).toEqual(freshRun);
  });
});
