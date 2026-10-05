import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AUTOMATION_DOWNTIME_RECONCILE_CAP,
  AUTOMATION_RECONCILE_LOOKBACK_MS,
  MAX_DATE_EPOCH_MS,
} from "../src/constants.js";
import { nextCronOccurrence, parseCronExpression } from "../src/cron-expression.js";
import { isValidTimeZone, nextScheduleOccurrence } from "../src/protocol.js";
import type { Automation, AutomationSchedule } from "../src/types.js";
import { compileSchedule, compileScheduleAll } from "../src/utils/compile-schedule.js";
import { computeNextAutomationRunAt } from "../src/utils/compute-next-automation-run-at.js";
import { enumerateMissedOccurrences } from "../src/utils/reconcile-downtime.js";

const epoch = (value: string): number => new Date(value).getTime();
const iso = (value: number | null): string | null =>
  value === null ? null : new Date(value).toISOString();
const next = (schedule: AutomationSchedule, from: string, timezone = "UTC"): string | null =>
  iso(nextScheduleOccurrence(schedule, new Date(from), timezone));
const automationWith = (schedule: AutomationSchedule, timezone?: string): Automation => ({
  id: "schedule-test",
  name: "schedule-test",
  trigger: { kind: "schedule", schedule },
  timezone,
  cwd: "/tmp",
  runner: { kind: "shell", command: "true" },
  enabled: true,
  limit: { kind: "forever" },
  closeOnFinish: false,
  requestedSecrets: [],
  runCount: 0,
  lifecycle: "active",
  runs: [],
  createdAt: 0,
  updatedAt: 0,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("public timezone validation", () => {
  it.each([
    "UTC",
    "America/New_York",
    "Asia/Kathmandu",
    "Australia/Lord_Howe",
    "Etc/GMT+5",
    "US/Eastern",
  ])("accepts %s", (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });
  it.each(["", " ", " UTC", "UTC ", "+01:00", "-0500", "Mars/Olympus", "America/Not_A_City"])(
    "rejects %s",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(false);
    },
  );
});

describe("anchored intervals", () => {
  it("has no misleading cron representation", () => {
    const schedule: AutomationSchedule = {
      kind: "interval",
      every: 90,
      unit: "minutes",
      anchorAt: 0,
    };
    expect(compileScheduleAll(schedule)).toEqual([]);
    expect(compileSchedule(schedule)).toBeNull();
  });

  it.each([
    [90, "minutes", "2026-01-01T01:37:12.345Z"],
    [25, "hours", "2026-01-02T01:07:12.345Z"],
    [2, "days", "2026-01-03T00:07:12.345Z"],
  ] as const)("keeps elapsed %i %s across calendar boundaries", (every, unit, expected) => {
    const anchor = "2026-01-01T00:07:12.345Z";
    expect(next({ kind: "interval", every, unit, anchorAt: epoch(anchor) }, anchor)).toBe(expected);
  });

  it("returns a future anchor, never a negative-index occurrence", () => {
    const anchorAt = epoch("2026-01-02T00:00:00Z");
    const schedule: AutomationSchedule = { kind: "interval", every: 1, unit: "minutes", anchorAt };
    expect(nextScheduleOccurrence(schedule, new Date(0))).toBe(anchorAt);
    expect(nextScheduleOccurrence(schedule, new Date(anchorAt - 1))).toBe(anchorAt);
    expect(nextScheduleOccurrence(schedule, new Date(anchorAt))).toBe(anchorAt + 60_000);
    expect(nextScheduleOccurrence(schedule, new Date(anchorAt + 60_001))).toBe(anchorAt + 120_000);
  });

  it.each(["2026-03-07T17:00:00Z", "2026-10-31T16:00:00Z"])(
    "a day stays 24 elapsed hours across DST from %s",
    (anchor) => {
      const anchorAt = epoch(anchor);
      const schedule: AutomationSchedule = { kind: "interval", every: 1, unit: "days", anchorAt };
      expect(nextScheduleOccurrence(schedule, new Date(anchorAt), "America/New_York")).toBe(
        anchorAt + 86_400_000,
      );
      expect(nextScheduleOccurrence(schedule, new Date(anchorAt), "Asia/Tokyo")).toBe(
        anchorAt + 86_400_000,
      );
    },
  );

  it("handles maximum intervals and date overflow", () => {
    expect(
      nextScheduleOccurrence(
        { kind: "interval", every: 100_000, unit: "days", anchorAt: 0 },
        new Date(0),
      ),
    ).toBe(8_640_000_000_000);
    expect(
      nextScheduleOccurrence(
        { kind: "interval", every: 1, unit: "minutes", anchorAt: MAX_DATE_EPOCH_MS },
        new Date(MAX_DATE_EPOCH_MS),
      ),
    ).toBeNull();
    expect(
      nextScheduleOccurrence(
        { kind: "interval", every: 1, unit: "minutes", anchorAt: MAX_DATE_EPOCH_MS },
        new Date(MAX_DATE_EPOCH_MS - 1),
      ),
    ).toBe(MAX_DATE_EPOCH_MS);
  });

  it.each([0, -1, 1.5, 100_001, NaN, Infinity])(
    "rejects invalid interval count %s without looping",
    (every) => {
      expect(
        nextScheduleOccurrence(
          { kind: "interval", every, unit: "minutes", anchorAt: 0 },
          new Date(0),
        ),
      ).toBeNull();
    },
  );
});

describe("calendar candidates", () => {
  it("is strictly after, including exact-minute and sub-minute cursors", () => {
    const schedule: AutomationSchedule = { kind: "daily", hour: 9, minute: 0 };
    expect(next(schedule, "2026-01-01T08:59:59.999Z")).toBe("2026-01-01T09:00:00.000Z");
    expect(next(schedule, "2026-01-01T09:00:00.000Z")).toBe("2026-01-02T09:00:00.000Z");
    expect(next(schedule, "2026-01-01T09:00:00.001Z")).toBe("2026-01-02T09:00:00.000Z");
  });

  it("keeps absent-timezone daemon-local cron semantics", () => {
    const from = new Date(2026, 0, 1, 8, 59, 45);
    for (const expression of [
      "0 9 * * *",
      "*/7 * * * *",
      "15 */5 * * *",
      "0 9 1 * MON",
      "0 0 29 2 *",
      "@yearly",
    ]) {
      const parsed = parseCronExpression(expression)!;
      expect(nextScheduleOccurrence({ kind: "cron", expression }, from)).toBe(
        nextCronOccurrence(parsed, from)?.getTime() ?? null,
      );
    }
  });

  it.each([
    ["Asia/Kathmandu", "2026-01-01T03:15:00.000Z"],
    ["Pacific/Kiritimati", "2026-01-01T19:00:00.000Z"],
    ["Pacific/Pago_Pago", "2026-01-01T20:00:00.000Z"],
  ])("uses the calendar date in %s, not the UTC date", (zone, expected) => {
    expect(next({ kind: "daily", hour: 9, minute: 0 }, "2026-01-01T00:00:00Z", zone)).toBe(
      expected,
    );
  });

  it("skips spring's nonexistent wall time rather than normalizing it forward", () => {
    expect(
      next({ kind: "daily", hour: 2, minute: 30 }, "2026-03-08T05:00:00Z", "America/New_York"),
    ).toBe("2026-03-09T06:30:00.000Z");
  });

  it("does not let a nonexistent time mask a valid candidate with a different offset", () => {
    const schedule: AutomationSchedule = {
      kind: "timesOfDay",
      times: [
        { hour: 1, minute: 15 },
        { hour: 2, minute: 15 },
      ],
    };
    expect(next(schedule, "2026-03-08T05:00:00Z", "America/New_York")).toBe(
      "2026-03-08T06:15:00.000Z",
    );
    expect(
      enumerateMissedOccurrences(
        automationWith(schedule, "America/New_York"),
        epoch("2026-03-08T05:00:00Z"),
        epoch("2026-03-08T10:00:00Z"),
      ),
    ).toEqual([epoch("2026-03-08T06:15:00Z")]);
  });

  it("returns both occurrences of a repeated wall time, in instant order", () => {
    const schedule: AutomationSchedule = { kind: "daily", hour: 1, minute: 30 };
    expect(next(schedule, "2026-11-01T04:00:00Z", "America/New_York")).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(next(schedule, "2026-11-01T05:30:00Z", "America/New_York")).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    expect(next(schedule, "2026-11-01T05:45:00Z", "America/New_York")).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    expect(next(schedule, "2026-11-01T06:30:00Z", "America/New_York")).toBe(
      "2026-11-02T06:30:00.000Z",
    );
  });

  it("orders multiple wall times across a fold by instant, not clock label", () => {
    const schedule: AutomationSchedule = {
      kind: "timesOfDay",
      times: [
        { hour: 1, minute: 15 },
        { hour: 1, minute: 45 },
      ],
    };
    expect(next(schedule, "2026-11-01T05:15:00Z", "America/New_York")).toBe(
      "2026-11-01T05:45:00.000Z",
    );
    expect(next(schedule, "2026-11-01T05:45:00Z", "America/New_York")).toBe(
      "2026-11-01T06:15:00.000Z",
    );
  });

  it("handles half-hour DST transitions", () => {
    expect(
      next({ kind: "daily", hour: 1, minute: 45 }, "2026-04-04T14:45:00Z", "Australia/Lord_Howe"),
    ).toBe("2026-04-04T15:15:00.000Z");
    expect(
      next({ kind: "daily", hour: 2, minute: 15 }, "2026-10-03T13:00:00Z", "Australia/Lord_Howe"),
    ).toBe("2026-10-04T15:15:00.000Z");
  });

  it("skips a whole deleted date at a date-line transition", () => {
    expect(
      next({ kind: "daily", hour: 12, minute: 0 }, "2011-12-29T22:00:00Z", "Pacific/Apia"),
    ).toBe("2011-12-30T22:00:00.000Z");
  });

  it("uses Vixie OR only for two restricted day fields", () => {
    const schedule: AutomationSchedule = { kind: "cron", expression: "0 9 1 * MON" };
    expect(next(schedule, "2026-01-01T09:00:00Z")).toBe("2026-01-05T09:00:00.000Z");
    expect(next(schedule, "2026-01-31T10:00:00Z")).toBe("2026-02-01T09:00:00.000Z");
    expect(next({ kind: "cron", expression: "0 9 * * MON" }, "2026-01-31T10:00:00Z")).toBe(
      "2026-02-02T09:00:00.000Z",
    );
    expect(next({ kind: "cron", expression: "0 9 31 2 MON" }, "2026-02-01T10:00:00Z")).toBe(
      "2026-02-02T09:00:00.000Z",
    );
  });

  it("validates actual month lengths and leap years", () => {
    expect(
      next({ kind: "monthly", daysOfMonth: [31], hour: 9, minute: 0 }, "2026-04-01T00:00:00Z"),
    ).toBe("2026-05-31T09:00:00.000Z");
    expect(next({ kind: "cron", expression: "0 0 29 2 *" }, "2026-01-01T00:00:00Z")).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    expect(next({ kind: "cron", expression: "0 0 31 2 *" }, "2026-01-01T00:00:00Z")).toBeNull();
    expect(next({ kind: "cron", expression: "0 0 29 2 *" }, "2099-01-01T00:00:00Z")).toBe(
      "2104-02-29T00:00:00.000Z",
    );
    expect(next({ kind: "cron", expression: "@yearly" }, "0099-01-02T00:00:00Z")).toBe(
      "0100-01-01T00:00:00.000Z",
    );
  });

  it("keeps valid boundary instants without constructing out-of-range Dates", () => {
    const schedule: AutomationSchedule = { kind: "daily", hour: 0, minute: 0 };
    expect(nextScheduleOccurrence(schedule, new Date(MAX_DATE_EPOCH_MS - 1), "UTC")).toBe(
      MAX_DATE_EPOCH_MS,
    );
    expect(nextScheduleOccurrence(schedule, new Date(MAX_DATE_EPOCH_MS), "UTC")).toBeNull();
  });

  it("fails closed for invalid cron, zone and cursor", () => {
    expect(next({ kind: "cron", expression: "not cron" }, "2026-01-01T00:00:00Z")).toBeNull();
    expect(
      next({ kind: "daily", hour: 9, minute: 0 }, "2026-01-01T00:00:00Z", "Invalid/Zone"),
    ).toBeNull();
    expect(nextScheduleOccurrence({ kind: "daily", hour: 9, minute: 0 }, new Date(NaN))).toBeNull();
  });

  it("bounds repeated calendar conversion work for 100 automation previews", () => {
    const formats = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    for (let index = 0; index < 100; index += 1) {
      expect(
        next({ kind: "cron", expression: "0 0 1 1 *" }, "2039-01-02T00:00:00Z", "Pacific/Auckland"),
      ).toBe("2039-12-31T11:00:00.000Z");
    }
    expect(formats.mock.calls.length).toBeLessThan(125);
  });

  it("generates sparse calendar candidates without formatting each elapsed minute", () => {
    const formats = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    expect(
      next({ kind: "cron", expression: "0 0 1 1 *" }, "2026-01-02T00:00:00Z", "America/New_York"),
    ).toBe("2027-01-01T05:00:00.000Z");
    expect(formats.mock.calls.length).toBeLessThan(40);
    formats.mockClear();
    expect(
      next({ kind: "cron", expression: "0 0 31 2 *" }, "2026-01-02T00:00:00Z", "America/New_York"),
    ).toBeNull();
    expect(formats).not.toHaveBeenCalled();
  });
});

describe("automation integration", () => {
  it("uses an explicit timezone and a supplied fake clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T05:00:00Z"));
    const automation = automationWith({ kind: "daily", hour: 9, minute: 0 }, "America/New_York");
    expect(iso(computeNextAutomationRunAt(automation, new Date()))).toBe(
      "2026-03-08T13:00:00.000Z",
    );
    expect(computeNextAutomationRunAt({ ...automation, enabled: false }, new Date())).toBeNull();
    expect(
      computeNextAutomationRunAt({ ...automation, lifecycle: "finished" }, new Date()),
    ).toBeNull();
    expect(
      computeNextAutomationRunAt(
        { ...automation, trigger: { kind: "watch", recursive: true } },
        new Date(),
      ),
    ).toBeNull();
  });

  it("enumerates the most recent interval occurrences arithmetically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-30T00:00:00Z"));
    const now = Date.now();
    const anchorAt = epoch("2026-01-01T00:07:12.345Z");
    const automation = automationWith(
      { kind: "interval", every: 90, unit: "minutes", anchorAt },
      "America/New_York",
    );
    const duration = 90 * 60_000;
    const latest = anchorAt + (Math.ceil((now - anchorAt) / duration) - 1) * duration;
    expect(enumerateMissedOccurrences(automation, 0, now)).toEqual(
      Array.from(
        { length: AUTOMATION_DOWNTIME_RECONCILE_CAP },
        (_, index) => latest - (AUTOMATION_DOWNTIME_RECONCILE_CAP - 1 - index) * duration,
      ),
    );
  });

  it("excludes both interval bounds and any time before the anchor", () => {
    const automation = automationWith({
      kind: "interval",
      every: 1,
      unit: "minutes",
      anchorAt: 120_000,
    });
    expect(enumerateMissedOccurrences(automation, 0, 120_000)).toEqual([]);
    expect(enumerateMissedOccurrences(automation, 0, 120_001)).toEqual([120_000]);
    expect(enumerateMissedOccurrences(automation, 120_000, 240_000)).toEqual([180_000]);
    expect(enumerateMissedOccurrences(automation, 240_000, 120_000)).toEqual([]);
    expect(enumerateMissedOccurrences(automation, NaN, 240_000)).toEqual([]);
  });

  it("enforces lookback even when fewer than cap occurrences exist", () => {
    const now = epoch("2026-01-30T00:00:00Z");
    const start = now - AUTOMATION_RECONCILE_LOOKBACK_MS;
    expect(
      enumerateMissedOccurrences(
        automationWith({ kind: "interval", every: 14, unit: "days", anchorAt: start }),
        0,
        now,
      ),
    ).toEqual([]);
    expect(
      enumerateMissedOccurrences(
        automationWith({ kind: "cron", expression: "0 0 1 * *" }, "UTC"),
        0,
        now,
      ),
    ).toEqual([]);
  });

  it("enumerates a fold twice but skips a gap", () => {
    expect(
      enumerateMissedOccurrences(
        automationWith({ kind: "daily", hour: 1, minute: 30 }, "America/New_York"),
        epoch("2026-11-01T04:00:00Z"),
        epoch("2026-11-01T07:00:00Z"),
      ),
    ).toEqual([epoch("2026-11-01T05:30:00Z"), epoch("2026-11-01T06:30:00Z")]);
    expect(
      enumerateMissedOccurrences(
        automationWith({ kind: "daily", hour: 2, minute: 30 }, "America/New_York"),
        epoch("2026-03-08T05:00:00Z"),
        epoch("2026-03-08T10:00:00Z"),
      ),
    ).toEqual([]);
  });

  it("merges and deduplicates times of day, excluding exact boundaries", () => {
    const automation = automationWith(
      {
        kind: "timesOfDay",
        times: [
          { hour: 18, minute: 0 },
          { hour: 9, minute: 0 },
          { hour: 9, minute: 0 },
        ],
      },
      "UTC",
    );
    expect(
      enumerateMissedOccurrences(
        automation,
        epoch("2026-01-01T09:00:00Z"),
        epoch("2026-01-02T18:00:00Z"),
      ),
    ).toEqual([epoch("2026-01-01T18:00:00Z"), epoch("2026-01-02T09:00:00Z")]);
  });

  it("caps frequent calendar catch-up work as well as its result", () => {
    const formats = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const now = epoch("2026-01-30T00:00:00Z");
    const result = enumerateMissedOccurrences(
      automationWith({ kind: "everyNMinutes", step: 1 }, "America/New_York"),
      0,
      now,
    );
    expect(result).toEqual(
      Array.from(
        { length: AUTOMATION_DOWNTIME_RECONCILE_CAP },
        (_, index) => now - (AUTOMATION_DOWNTIME_RECONCILE_CAP - index) * 60_000,
      ),
    );
    expect(formats.mock.calls.length).toBeLessThan(100);
  });
});
