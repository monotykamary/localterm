import { describe, expect, it } from "vite-plus/test";
import {
  cronMatchesDate,
  nextCronOccurrence,
  parseCronExpression,
} from "../src/cron-expression.js";

const parseOrThrow = (expression: string) => {
  const parsed = parseCronExpression(expression);
  if (!parsed) throw new Error(`expected "${expression}" to parse`);
  return parsed;
};

describe("parseCronExpression", () => {
  it("parses a wildcard expression", () => {
    const parsed = parseOrThrow("* * * * *");
    expect(parsed.minutes.size).toBe(60);
    expect(parsed.hours.size).toBe(24);
    expect(parsed.daysOfMonth.size).toBe(31);
    expect(parsed.months.size).toBe(12);
    expect(parsed.isDayOfMonthRestricted).toBe(false);
    expect(parsed.isDayOfWeekRestricted).toBe(false);
  });

  it("parses lists, ranges, and steps", () => {
    const parsed = parseOrThrow("0,30 9-17 */2 1,6 mon-fri");
    expect([...parsed.minutes]).toEqual([0, 30]);
    expect([...parsed.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...parsed.daysOfMonth]).toEqual([
      1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31,
    ]);
    expect([...parsed.months]).toEqual([1, 6]);
    expect([...parsed.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses ranged steps", () => {
    const parsed = parseOrThrow("10-30/10 * * * *");
    expect([...parsed.minutes]).toEqual([10, 20, 30]);
  });

  it("treats a bare value with a step as value-to-max", () => {
    const parsed = parseOrThrow("5/15 * * * *");
    expect([...parsed.minutes]).toEqual([5, 20, 35, 50]);
  });

  it("parses month and weekday names case-insensitively", () => {
    const parsed = parseOrThrow("0 0 1 JAN SUN");
    expect([...parsed.months]).toEqual([1]);
    expect(parsed.daysOfWeek.has(0)).toBe(true);
  });

  it("normalizes day-of-week 7 to sunday", () => {
    const parsed = parseOrThrow("0 0 * * 7");
    expect(parsed.daysOfWeek.has(0)).toBe(true);
  });

  it("expands @aliases", () => {
    expect(parseCronExpression("@hourly")).toEqual(parseCronExpression("0 * * * *"));
    expect(parseCronExpression("@daily")).toEqual(parseCronExpression("0 0 * * *"));
    expect(parseCronExpression("@weekly")).toEqual(parseCronExpression("0 0 * * 0"));
    expect(parseCronExpression("@monthly")).toEqual(parseCronExpression("0 0 1 * *"));
    expect(parseCronExpression("@yearly")).toEqual(parseCronExpression("0 0 1 1 *"));
  });

  it("rejects malformed expressions", () => {
    expect(parseCronExpression("")).toBeNull();
    expect(parseCronExpression("* * * *")).toBeNull();
    expect(parseCronExpression("* * * * * *")).toBeNull();
    expect(parseCronExpression("60 * * * *")).toBeNull();
    expect(parseCronExpression("* 24 * * *")).toBeNull();
    expect(parseCronExpression("* * 0 * *")).toBeNull();
    expect(parseCronExpression("* * 32 * *")).toBeNull();
    expect(parseCronExpression("* * * 13 *")).toBeNull();
    expect(parseCronExpression("* * * * 8")).toBeNull();
    expect(parseCronExpression("*/0 * * * *")).toBeNull();
    expect(parseCronExpression("5-1 * * * *")).toBeNull();
    expect(parseCronExpression("a * * * *")).toBeNull();
    expect(parseCronExpression("1//2 * * * *")).toBeNull();
    expect(parseCronExpression("1-2-3 * * * *")).toBeNull();
    expect(parseCronExpression("@fortnightly")).toBeNull();
  });
});

describe("cronMatchesDate", () => {
  it("matches minute, hour, month, and day", () => {
    const parsed = parseOrThrow("30 14 15 6 *");
    expect(cronMatchesDate(parsed, new Date(2026, 5, 15, 14, 30))).toBe(true);
    expect(cronMatchesDate(parsed, new Date(2026, 5, 15, 14, 31))).toBe(false);
    expect(cronMatchesDate(parsed, new Date(2026, 5, 16, 14, 30))).toBe(false);
    expect(cronMatchesDate(parsed, new Date(2026, 6, 15, 14, 30))).toBe(false);
  });

  it("requires the weekday when only day-of-week is restricted", () => {
    const parsed = parseOrThrow("0 9 * * mon");
    expect(cronMatchesDate(parsed, new Date(2026, 5, 15, 9, 0))).toBe(true);
    expect(cronMatchesDate(parsed, new Date(2026, 5, 16, 9, 0))).toBe(false);
  });

  it("matches either day field when both are restricted (vixie semantics)", () => {
    const parsed = parseOrThrow("0 9 13 * fri");
    expect(cronMatchesDate(parsed, new Date(2026, 5, 13, 9, 0))).toBe(true);
    expect(cronMatchesDate(parsed, new Date(2026, 5, 19, 9, 0))).toBe(true);
    expect(cronMatchesDate(parsed, new Date(2026, 5, 18, 9, 0))).toBe(false);
  });
});

describe("nextCronOccurrence", () => {
  it("finds the next minute boundary strictly after `from`", () => {
    const parsed = parseOrThrow("* * * * *");
    const from = new Date(2026, 5, 13, 10, 15, 30);
    const next = nextCronOccurrence(parsed, from);
    expect(next).toEqual(new Date(2026, 5, 13, 10, 16, 0));
  });

  it("does not return a matching `from` minute itself", () => {
    const parsed = parseOrThrow("15 10 * * *");
    const from = new Date(2026, 5, 13, 10, 15, 0);
    const next = nextCronOccurrence(parsed, from);
    expect(next).toEqual(new Date(2026, 5, 14, 10, 15, 0));
  });

  it("skips ahead across days and months", () => {
    const parsed = parseOrThrow("0 0 1 1 *");
    const from = new Date(2026, 5, 13, 12, 0, 0);
    const next = nextCronOccurrence(parsed, from);
    expect(next).toEqual(new Date(2027, 0, 1, 0, 0, 0));
  });

  it("finds a leap-day-only schedule", () => {
    const parsed = parseOrThrow("0 12 29 2 *");
    const from = new Date(2026, 5, 13, 12, 0, 0);
    const next = nextCronOccurrence(parsed, from);
    expect(next).toEqual(new Date(2028, 1, 29, 12, 0, 0));
  });

  it("returns null when the schedule can never fire", () => {
    const parsed = parseOrThrow("0 0 31 2 *");
    expect(nextCronOccurrence(parsed, new Date(2026, 5, 13))).toBeNull();
  });
});
