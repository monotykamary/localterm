import {
  SCHEDULE_CALENDAR_SCAN_LIMIT_DAYS,
  MAX_AUTOMATION_INTERVAL,
  MAX_DATE_EPOCH_MS,
  SCHEDULE_DAY_MS,
  SCHEDULE_HOUR_MS,
  SCHEDULE_MINUTE_MS,
  SCHEDULE_OFFSET_SAMPLE_MS,
  SCHEDULE_OFFSET_CACHE_MAX_DAYS,
  SCHEDULE_TIME_ZONE_CACHE_MAX_ENTRIES,
} from "../constants.js";
import { parseCronExpression, type ParsedCronExpression } from "../cron-expression.js";
import type { AutomationSchedule } from "../types.js";
import { compileScheduleAll } from "./compile-schedule.js";
import { isValidTimeZone } from "./is-valid-time-zone.js";

const intervalDuration = (schedule: Extract<AutomationSchedule, { kind: "interval" }>): number => {
  if (
    !Number.isInteger(schedule.every) ||
    schedule.every < 1 ||
    schedule.every > MAX_AUTOMATION_INTERVAL ||
    !Number.isInteger(schedule.anchorAt) ||
    schedule.anchorAt < 0 ||
    schedule.anchorAt > MAX_DATE_EPOCH_MS
  )
    return NaN;
  switch (schedule.unit) {
    case "minutes":
      return schedule.every * SCHEDULE_MINUTE_MS;
    case "hours":
      return schedule.every * SCHEDULE_HOUR_MS;
    case "days":
      return schedule.every * SCHEDULE_DAY_MS;
    default:
      return NaN;
  }
};

const matchesDay = (parsed: ParsedCronExpression, day: Date): boolean => {
  if (!parsed.months.has(day.getUTCMonth() + 1)) return false;
  const monthDay = parsed.daysOfMonth.has(day.getUTCDate());
  const weekDay = parsed.daysOfWeek.has(day.getUTCDay());
  return parsed.isDayOfMonthRestricted && parsed.isDayOfWeekRestricted
    ? monthDay || weekDay
    : monthDay && weekDay;
};

// Interpret the formatted wall clock as UTC purely for calendar arithmetic.
// setUTCFullYear avoids Date.UTC's special handling of years 0 through 99.
const wallTime = (formatter: Intl.DateTimeFormat, instant: number): number => {
  if (Math.abs(instant) > MAX_DATE_EPOCH_MS) return NaN;
  const fields: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) fields[part.type] = part.value;
  const year = Number(fields.year);
  const wall = new Date(0);
  wall.setUTCFullYear(
    fields.era === "BC" ? 1 - year : year,
    Number(fields.month) - 1,
    Number(fields.day),
  );
  wall.setUTCHours(Number(fields.hour), Number(fields.minute), Number(fields.second), 0);
  return wall.getTime();
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new WeakMap<Intl.DateTimeFormat, Map<number, readonly number[]>>();

const calendarFormatter = (timezone?: string): Intl.DateTimeFormat | null => {
  if (timezone !== undefined) {
    const cached = formatters.get(timezone);
    if (cached) return cached;
    if (!isValidTimeZone(timezone)) return null;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    era: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  // Do not retain the implicit local zone: the host may change its timezone.
  if (timezone !== undefined) {
    if (formatters.size >= SCHEDULE_TIME_ZONE_CACHE_MAX_ENTRIES) {
      const oldest = formatters.keys().next().value;
      if (oldest !== undefined) formatters.delete(oldest);
    }
    formatters.set(timezone, formatter);
  }
  return formatter;
};

const calendarOffsets = (formatter: Intl.DateTimeFormat, day: number): readonly number[] => {
  const cache = offsetCache.get(formatter) ?? new Map<number, readonly number[]>();
  const cached = cache.get(day);
  if (cached) return cached;
  const offsets = new Set<number>();
  // Sample both sides of the wall date, not just the current offset.
  // IANA transitions are farther apart than this sampling step; a fold
  // may be 30 minutes or an entire day, not necessarily one hour.
  for (
    let sample = day - SCHEDULE_DAY_MS;
    sample <= day + 2 * SCHEDULE_DAY_MS;
    sample += SCHEDULE_OFFSET_SAMPLE_MS
  ) {
    const offset = wallTime(formatter, sample) - sample;
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  if (cache.size >= SCHEDULE_OFFSET_CACHE_MAX_DAYS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const result = [...offsets];
  cache.set(day, result);
  offsetCache.set(formatter, cache);
  return result;
};

const calendarOccurrences = (
  schedule: AutomationSchedule,
  start: number,
  end: number,
  cap: number,
  direction: 1 | -1,
  timezone?: string,
): number[] => {
  const formatter = calendarFormatter(timezone);
  if (!formatter) return [];
  const expressions = compileScheduleAll(schedule)
    .map(parseCronExpression)
    .filter((parsed): parsed is ParsedCronExpression => parsed !== null);
  if (expressions.length === 0) return [];
  const sort = (a: number, b: number): number => direction * (a - b);
  let found: number[] = [];
  const boundary = direction === 1 ? start : end;
  let day = Math.floor(boundary / SCHEDULE_DAY_MS) * SCHEDULE_DAY_MS - direction * SCHEDULE_DAY_MS;
  // All IANA offsets fit inside a day. The padding also keeps candidate
  // instants correctly ordered across midnight folds and date-line changes.
  while (direction === 1 ? day - SCHEDULE_DAY_MS < end : day + 2 * SCHEDULE_DAY_MS > start) {
    if (found.length === cap) {
      const worst = found[found.length - 1];
      if (direction === 1 ? day - SCHEDULE_DAY_MS >= worst : day + 2 * SCHEDULE_DAY_MS <= worst)
        break;
    }
    const date = new Date(day);
    const walls = new Set<number>();
    for (const parsed of expressions) {
      if (!matchesDay(parsed, date)) continue;
      for (const hour of parsed.hours) {
        for (const minute of parsed.minutes) {
          walls.add(day + hour * SCHEDULE_HOUR_MS + minute * SCHEDULE_MINUTE_MS);
        }
      }
    }
    if (walls.size > 0) {
      const offsets = calendarOffsets(formatter, day);
      const candidates = new Set<number>();
      for (const wall of walls) {
        for (const offset of offsets) {
          const instant = wall - offset;
          if (instant > start && instant < end) candidates.add(instant);
        }
      }
      const matches: number[] = [];
      for (const instant of [...candidates].sort(sort)) {
        if (found.length === cap && sort(instant, found[found.length - 1]) >= 0) break;
        // Round-tripping rejects nonexistent times; both offsets of a fold
        // survive as distinct instants, without normalizing a gap forward.
        if (walls.has(wallTime(formatter, instant))) matches.push(instant);
        if (matches.length === cap) break;
      }
      found = [...new Set([...found, ...matches])].sort(sort).slice(0, cap);
    }
    day += direction * SCHEDULE_DAY_MS;
  }
  return found;
};

export const nextScheduleOccurrence = (
  schedule: AutomationSchedule,
  from: Date,
  timezone?: string,
): number | null => {
  const start = from.getTime();
  if (!Number.isFinite(start)) return null;
  if (schedule.kind === "interval") {
    const duration = intervalDuration(schedule);
    if (!Number.isFinite(duration)) return null;
    const index = Math.max(0, Math.floor((start - schedule.anchorAt) / duration) + 1);
    const next = schedule.anchorAt + index * duration;
    return next > start && next <= MAX_DATE_EPOCH_MS ? next : null;
  }
  const end = Math.min(
    MAX_DATE_EPOCH_MS + 1,
    start + SCHEDULE_CALENDAR_SCAN_LIMIT_DAYS * SCHEDULE_DAY_MS,
  );
  return calendarOccurrences(schedule, start, end, 1, 1, timezone)[0] ?? null;
};

// Internal shared reverse search for downtime reconciliation, not protocol API.
export const recentScheduleOccurrences = (
  schedule: AutomationSchedule,
  start: number,
  end: number,
  cap: number,
  timezone?: string,
): number[] => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || cap < 1) return [];
  if (schedule.kind === "interval") {
    const duration = intervalDuration(schedule);
    if (!Number.isFinite(duration)) return [];
    const result: number[] = [];
    let index = Math.ceil((end - schedule.anchorAt) / duration) - 1;
    while (index >= 0 && result.length < cap) {
      const instant = schedule.anchorAt + index * duration;
      if (instant <= start) break;
      if (instant <= MAX_DATE_EPOCH_MS) result.push(instant);
      index -= 1;
    }
    return result.reverse();
  }
  return calendarOccurrences(schedule, start, end, cap, -1, timezone).reverse();
};
