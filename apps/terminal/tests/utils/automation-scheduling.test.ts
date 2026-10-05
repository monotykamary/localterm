import { describe, expect, it } from "vite-plus/test";
import { automationFixture, runFixture } from "../fixtures/automation";
import { automationAgenda, matchesAgendaFilter } from "../../src/utils/automation-agenda";
import { automationPolicyInput } from "../../src/utils/automation-policy-input";
import { defaultRunnerForm } from "../../src/utils/runner-form";
import {
  defaultScheduleForm,
  recognizeScheduleForm,
  buildScheduleFromForm,
} from "../../src/utils/schedule-builder";
import { scheduleOccurrences } from "../../src/utils/schedule-occurrences";
import { scheduleValidationError } from "../../src/utils/schedule-validation-error";
import { localDatetimeValue } from "../../src/utils/local-datetime-value";
import { AUTOMATION_AGENDA_MAX_ROWS } from "../../src/lib/constants";

const now = Date.UTC(2026, 0, 1);
describe("automation scheduling UX", () => {
  it("keeps exact interval anchors and legacy clock-aligned steps", () => {
    for (const schedule of [
      { kind: "interval", every: 17, unit: "minutes", anchorAt: now + 1234 },
      { kind: "everyNMinutes", step: 7 },
      { kind: "everyNHours", step: 5, minute: 13 },
    ] as const)
      expect(buildScheduleFromForm(recognizeScheduleForm(schedule))).toEqual(schedule);
    expect(new Date(localDatetimeValue(now + 1234)).getTime()).toBe(now + 1234);
  });
  it("uses absolute zone-aware occurrences, including a fixed elapsed interval", () => {
    expect(
      scheduleOccurrences({ kind: "daily", hour: 9, minute: 0 }, now, "Asia/Kathmandu", 2),
    ).toEqual([Date.UTC(2026, 0, 1, 3, 15), Date.UTC(2026, 0, 2, 3, 15)]);
    expect(
      scheduleOccurrences(
        { kind: "interval", every: 17, unit: "minutes", anchorAt: now + 1234 },
        now,
        "America/New_York",
        2,
      ),
    ).toEqual([now + 1234, now + 1234 + 17 * 60_000]);
  });
  it("previews both real instants during a daylight-saving fold", () => {
    expect(
      scheduleOccurrences(
        { kind: "daily", hour: 1, minute: 30 },
        Date.UTC(2026, 10, 1),
        "America/New_York",
        2,
      ),
    ).toEqual([Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 6, 30)]);
  });

  it("merges projects chronologically while respecting each remaining launch count", () => {
    const schedule = { kind: "interval", every: 1, unit: "hours", anchorAt: now + 1 } as const;
    const early = automationFixture({
      id: "early",
      limit: { kind: "count", max: 2 },
      trigger: { kind: "schedule", schedule },
    });
    const late = automationFixture({
      id: "late",
      cwd: "/project/beta",
      limit: { kind: "count", max: 2 },
      trigger: { kind: "schedule", schedule: { ...schedule, anchorAt: now + 2 } },
    });
    const agenda = automationAgenda([late, early], now);
    expect(agenda.rows.map((row) => row.automation.id)).toEqual(["early", "late", "early", "late"]);
    expect(agenda.truncated).toBe(false);
  });

  it("validates timezone, interval range, anchor and empty calendar selections", () => {
    const base = defaultScheduleForm();
    expect(scheduleValidationError(base, "Mars/Olympus")).toMatch(/IANA/);
    expect(scheduleValidationError(base, "Pacific/Chatham")).toBeNull();
    for (const intervalEvery of [0, 100001, 1.5, NaN])
      expect(
        scheduleValidationError({ ...base, frequency: "interval", intervalEvery }, "UTC"),
      ).toMatch(/whole interval/);
    expect(
      scheduleValidationError({ ...base, frequency: "interval", intervalAnchorAt: NaN }, "UTC"),
    ).toMatch(/start date/);
    expect(
      scheduleValidationError({ ...base, frequency: "weekly", daysOfWeek: [] }, "UTC"),
    ).toMatch(/weekday/);
    expect(
      scheduleValidationError({ ...base, frequency: "cron", cron: "nonsense" }, "UTC"),
    ).not.toBeNull();
  });
  it("defaults policies safely and serializes thread agents without allow", () => {
    const runner = defaultRunnerForm();
    expect(automationPolicyInput({ runner })).toEqual({
      concurrencyPolicy: "skip",
      missedRunPolicy: "skip",
    });
    expect(
      automationPolicyInput({
        runner,
        timezone: "Pacific/Chatham",
        concurrencyPolicy: "allow",
        missedRunPolicy: "run-latest",
      }),
    ).toEqual({
      timezone: "Pacific/Chatham",
      concurrencyPolicy: "allow",
      missedRunPolicy: "run-latest",
    });
    expect(
      automationPolicyInput({
        runner: { ...runner, runnerType: "agent", agentSessionMode: "thread" },
        concurrencyPolicy: "allow",
      }).concurrencyPolicy,
    ).toBe("queue-latest");
  });
  it("excludes paused, finished, event-only and exhausted schedules and honors remaining counts", () => {
    const limited = automationFixture({
      limit: { kind: "count", max: 3 },
      runCount: 2,
      runs: [runFixture()],
    });
    const list = [
      limited,
      automationFixture({ id: "paused", enabled: false }),
      automationFixture({ id: "done", lifecycle: "finished" }),
      automationFixture({ id: "event", trigger: { kind: "watch", recursive: true } }),
      automationFixture({ id: "exhausted", limit: { kind: "count", max: 1 }, runCount: 1 }),
    ];
    const agenda = automationAgenda(list, now);
    expect(agenda.rows).toHaveLength(1);
    expect(agenda.rows[0].automation.id).toBe(limited.id);
    expect(matchesAgendaFilter(limited, "queued")).toBe(true);
    expect(matchesAgendaFilter(limited, "active")).toBe(false);
  });
  it("bounds and sorts frequent schedules and refuses to invent a legacy server zone", () => {
    const frequent = automationFixture({
      trigger: {
        kind: "schedule",
        schedule: { kind: "interval", every: 1, unit: "minutes", anchorAt: now },
      },
    });
    const agenda = automationAgenda([frequent], now);
    expect(agenda.rows).toHaveLength(AUTOMATION_AGENDA_MAX_ROWS);
    expect(agenda.truncated).toBe(true);
    expect(
      agenda.rows.every((row, index) => index === 0 || row.at > agenda.rows[index - 1].at),
    ).toBe(true);
    const unknown = automationAgenda([automationFixture({ timezone: undefined })], now);
    expect(unknown.rows).toHaveLength(0);
    expect(unknown.unknownZoneIds).toEqual(["build"]);
  });
});
