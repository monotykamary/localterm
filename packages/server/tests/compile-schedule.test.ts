import { describe, expect, it } from "vite-plus/test";
import { parseCronExpression, type ParsedCronExpression } from "../src/cron-expression.js";
import type { AutomationSchedule } from "../src/types.js";
import {
  compileSchedule,
  compileScheduleAll,
  normalizeScheduleInput,
  normalizeTriggerInput,
  recognizePreset,
} from "../src/utils/compile-schedule.js";

const setsEqual = (a: ReadonlySet<number>, b: ReadonlySet<number>) =>
  a.size === b.size && [...a].every((value) => b.has(value));

const parsedEqual = (a: ParsedCronExpression, b: ParsedCronExpression) =>
  setsEqual(a.minutes, b.minutes) &&
  setsEqual(a.hours, b.hours) &&
  setsEqual(a.daysOfMonth, b.daysOfMonth) &&
  setsEqual(a.months, b.months) &&
  setsEqual(a.daysOfWeek, b.daysOfWeek) &&
  a.isDayOfMonthRestricted === b.isDayOfMonthRestricted &&
  a.isDayOfWeekRestricted === b.isDayOfWeekRestricted;

describe("compileScheduleAll", () => {
  const cases: Array<[AutomationSchedule, string[]]> = [
    [{ kind: "hourly", minute: 30 }, ["30 * * * *"]],
    [{ kind: "daily", hour: 9, minute: 0 }, ["0 9 * * *"]],
    [{ kind: "weekdaysPreset", preset: "weekdays", hour: 9, minute: 0 }, ["0 9 * * 1-5"]],
    [{ kind: "weekdaysPreset", preset: "weekends", hour: 9, minute: 0 }, ["0 9 * * 0,6"]],
    [{ kind: "weekly", daysOfWeek: [5, 1, 3], hour: 8, minute: 15 }, ["15 8 * * 1,3,5"]],
    [{ kind: "monthly", daysOfMonth: [15, 1], hour: 0, minute: 0 }, ["0 0 1,15 * *"]],
    [{ kind: "everyNMinutes", step: 15 }, ["*/15 * * * *"]],
    [{ kind: "everyNHours", step: 4, minute: 0 }, ["0 */4 * * *"]],
    [{ kind: "cron", expression: "0 9 * * 1-5" }, ["0 9 * * 1-5"]],
  ];

  it("compiles each kind to its canonical cron, sorting list fields", () => {
    for (const [schedule, expected] of cases) {
      expect(compileScheduleAll(schedule)).toEqual(expected);
    }
  });

  it("compiles timesOfDay to one cron per distinct time, earliest first", () => {
    expect(
      compileScheduleAll({
        kind: "timesOfDay",
        times: [
          { hour: 17, minute: 30 },
          { hour: 9, minute: 0 },
          { hour: 9, minute: 0 },
        ],
      }),
    ).toEqual(["0 9 * * *", "30 17 * * *"]);
  });

  it("compileSchedule returns the earliest cron for a multi-time schedule", () => {
    expect(
      compileSchedule({
        kind: "timesOfDay",
        times: [
          { hour: 17, minute: 0 },
          { hour: 6, minute: 0 },
        ],
      }),
    ).toBe("0 6 * * *");
  });
});

describe("recognizePreset", () => {
  const recognized: Array<[string, AutomationSchedule]> = [
    ["0 9 * * *", { kind: "daily", hour: 9, minute: 0 }],
    ["30 * * * *", { kind: "hourly", minute: 30 }],
    ["0 9 * * 1-5", { kind: "weekdaysPreset", preset: "weekdays", hour: 9, minute: 0 }],
    ["0 9 * * 1,2,3,4,5", { kind: "weekdaysPreset", preset: "weekdays", hour: 9, minute: 0 }],
    ["0 9 * * 0,6", { kind: "weekdaysPreset", preset: "weekends", hour: 9, minute: 0 }],
    ["0 9 * * 1,3,5", { kind: "weekly", daysOfWeek: [1, 3, 5], hour: 9, minute: 0 }],
    ["*/15 * * * *", { kind: "everyNMinutes", step: 15 }],
    ["0 */4 * * *", { kind: "everyNHours", step: 4, minute: 0 }],
    ["0 0 1,15 * *", { kind: "monthly", daysOfMonth: [1, 15], hour: 0, minute: 0 }],
    ["@daily", { kind: "daily", hour: 0, minute: 0 }],
  ];

  it("recognizes common cron shapes as friendly presets", () => {
    for (const [cron, schedule] of recognized) {
      expect(recognizePreset(cron)).toEqual(schedule);
    }
  });

  it("guarantees every recognized preset recompiles to a parse-equal cron", () => {
    for (const [cron] of recognized) {
      const preset = recognizePreset(cron);
      expect(preset).not.toBeNull();
      const original = parseCronExpression(cron);
      const recompiled = parseCronExpression(compileScheduleAll(preset as AutomationSchedule)[0]);
      expect(original).not.toBeNull();
      expect(recompiled).not.toBeNull();
      expect(
        parsedEqual(original as ParsedCronExpression, recompiled as ParsedCronExpression),
      ).toBe(true);
    }
  });

  it("falls back to null for ambiguous, restricted-month, or invalid crons", () => {
    expect(recognizePreset("0 9 1 * 1")).toBeNull(); // both day fields restricted (Vixie OR)
    expect(recognizePreset("0 9 * 6 *")).toBeNull(); // restricted month
    expect(recognizePreset("0 9-17 * * *")).toBeNull(); // hour range, not */step
    expect(recognizePreset("not a cron")).toBeNull();
  });
});

describe("normalizeScheduleInput", () => {
  it("recognizes a bare cron string", () => {
    expect(normalizeScheduleInput("0 9 * * *")).toEqual({ kind: "daily", hour: 9, minute: 0 });
  });

  it("wraps an unrecognizable string as raw cron", () => {
    expect(normalizeScheduleInput("0 9 1 * 1")).toEqual({ kind: "cron", expression: "0 9 1 * 1" });
  });

  it("passes a structured schedule through unchanged", () => {
    const schedule: AutomationSchedule = { kind: "everyNMinutes", step: 5 };
    expect(normalizeScheduleInput(schedule)).toBe(schedule);
  });

  it("keeps an explicit cron schedule advanced even when it is recognizable", () => {
    const schedule: AutomationSchedule = { kind: "cron", expression: "0 9 * * *" };
    expect(normalizeScheduleInput(schedule)).toBe(schedule);
  });
});

describe("normalizeTriggerInput", () => {
  it("normalizes a schedule trigger payload (recognizing a bare cron)", () => {
    expect(normalizeTriggerInput({ kind: "schedule", schedule: "0 9 * * *" })).toEqual({
      kind: "schedule",
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });
  });

  it("recognizes a bare cron string inside a schedule trigger as a preset", () => {
    expect(normalizeTriggerInput({ kind: "schedule", schedule: "0 9 * * 1-5" })).toEqual({
      kind: "schedule",
      schedule: { kind: "weekdaysPreset", preset: "weekdays", hour: 9, minute: 0 },
    });
    expect(
      normalizeTriggerInput({ kind: "schedule", schedule: { kind: "everyNMinutes", step: 5 } }),
    ).toEqual({ kind: "schedule", schedule: { kind: "everyNMinutes", step: 5 } });
  });

  it("defaults watch.recursive to true and preserves an explicit value", () => {
    expect(normalizeTriggerInput({ kind: "watch" })).toEqual({ kind: "watch", recursive: true });
    expect(normalizeTriggerInput({ kind: "watch", recursive: false })).toEqual({
      kind: "watch",
      recursive: false,
    });
  });
});
