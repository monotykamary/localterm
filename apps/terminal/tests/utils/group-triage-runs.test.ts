import { describe, expect, it } from "vite-plus/test";
import type {
  AutomationRunRecord,
  AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import { groupTriageRuns } from "../../src/utils/group-triage-runs";

const makeAutomation = (id: string, name = id): AutomationWithNextRun => ({
  id,
  name,
  trigger: { kind: "webhook", id: `wh-${id}` },
  cwd: `/repo/${id}`,
  runner: { kind: "shell", command: "echo hi" },
  enabled: true,
  limit: { kind: "forever" },
  closeOnFinish: false,
  requestedSecrets: [],
  runCount: 0,
  lifecycle: "active",
  runs: [],
  createdAt: 0,
  updatedAt: 0,
  nextRunAt: null,
  cron: null,
  lastRun: null,
});

const makeRun = (
  overrides: Partial<AutomationRunRecord> & { runId: string; scheduledFor: number },
): AutomationRunRecord => ({
  startedAt: null,
  finishedAt: null,
  status: "completed",
  exitCode: 0,
  trigger: "schedule",
  countsTowardLimit: true,
  findings: null,
  changedFiles: [],
  unread: false,
  log: null,
  ...overrides,
});

// Local noon keeps run timestamps mid-day (see triage-date-bands test).
const nowMs = new Date(2026, 6, 7, 12, 0, 0).getTime();
const hoursAgo = (hours: number): number => nowMs - hours * 3_600_000;

describe("groupTriageRuns", () => {
  it("returns no sections for an empty set", () => {
    expect(groupTriageRuns([], nowMs)).toEqual([]);
  });

  it("keeps a single run inline instead of threading", () => {
    const sections = groupTriageRuns(
      [
        {
          automation: makeAutomation("alpha"),
          run: makeRun({ runId: "r1", scheduledFor: hoursAgo(1) }),
        },
      ],
      nowMs,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe("Today");
    expect(sections[0].rows).toHaveLength(1);
    const row = sections[0].rows[0];
    expect(row.kind).toBe("inline");
    if (row.kind === "inline") expect(row.latestTimestamp).toBe(hoursAgo(1));
  });

  it("threads same-automation runs, newest-first, and counts unread", () => {
    const automation = makeAutomation("push-watcher", "push watcher");
    const sections = groupTriageRuns(
      [
        { automation, run: makeRun({ runId: "r1", scheduledFor: hoursAgo(1), unread: true }) },
        { automation, run: makeRun({ runId: "r2", scheduledFor: hoursAgo(2) }) },
        { automation, run: makeRun({ runId: "r3", scheduledFor: hoursAgo(3), unread: true }) },
      ],
      nowMs,
    );
    const row = sections[0].rows[0];
    expect(row.kind).toBe("thread");
    if (row.kind === "thread") {
      expect(row.runs).toHaveLength(3);
      expect(row.runs.map((run) => run.runId)).toEqual(["r1", "r2", "r3"]);
      expect(row.unreadCount).toBe(2);
      expect(row.latestTimestamp).toBe(hoursAgo(1));
    }
  });

  it("orders rows newest-first across automations within a band", () => {
    const sections = groupTriageRuns(
      [
        {
          automation: makeAutomation("older"),
          run: makeRun({ runId: "o1", scheduledFor: hoursAgo(10) }),
        },
        {
          automation: makeAutomation("newer"),
          run: makeRun({ runId: "n1", scheduledFor: hoursAgo(1) }),
        },
      ],
      nowMs,
    );
    const first = sections[0].rows[0];
    const second = sections[0].rows[1];
    expect(first.kind).toBe("inline");
    expect(second.kind).toBe("inline");
    if (first.kind === "inline" && second.kind === "inline") {
      expect(first.automation.id).toBe("newer");
      expect(second.automation.id).toBe("older");
    }
  });

  it("places a thread in the band of its newest run", () => {
    const automation = makeAutomation("push-watcher");
    const sections = groupTriageRuns(
      [
        { automation, run: makeRun({ runId: "r1", scheduledFor: hoursAgo(1) }) },
        { automation, run: makeRun({ runId: "r2", scheduledFor: hoursAgo(28) }) },
      ],
      nowMs,
    );
    // Newest run is Today, so the whole thread lives in Today (not Yesterday).
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe("Today");
    expect(sections[0].rows[0].kind).toBe("thread");
  });

  it("emits sections in Today / Yesterday / This week / Earlier order regardless of input order", () => {
    const sections = groupTriageRuns(
      [
        {
          automation: makeAutomation("earlier"),
          run: makeRun({ runId: "d1", scheduledFor: hoursAgo(196) }),
        },
        {
          automation: makeAutomation("week"),
          run: makeRun({ runId: "c1", scheduledFor: hoursAgo(76) }),
        },
        {
          automation: makeAutomation("yesterday"),
          run: makeRun({ runId: "b1", scheduledFor: hoursAgo(28) }),
        },
        {
          automation: makeAutomation("today"),
          run: makeRun({ runId: "a1", scheduledFor: hoursAgo(1) }),
        },
      ],
      nowMs,
    );
    expect(sections.map((section) => section.label)).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "Earlier",
    ]);
  });
});
