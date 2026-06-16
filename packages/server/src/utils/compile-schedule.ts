// The cron engine is the single timing authority. Every structured schedule
// kind compiles here to one — or, for "timesOfDay", several — 5-field cron
// strings that the scheduler and next-run util parse directly. Nothing derived
// is persisted; this runs on the fly.
//
// recognizePreset() goes the other way (a raw cron string -> a friendly preset)
// and is the v1->v2 migration's and the bare-string API's only path to friendly
// labels. It is provably lossless: a candidate preset is accepted ONLY if it
// recompiles to a cron whose parse is set-equal to the original. Any divergence
// (or an unparseable string) falls back to {kind:"cron"} byte-for-byte, so the
// firing schedule never changes.

import { parseCronExpression, type ParsedCronExpression } from "../cron-expression.js";
import type { AutomationSchedule, AutomationTrigger, TriggerInput } from "../types.js";
import { memoBy } from "./memo-by.js";

const WEEKDAYS_CRON_DOW = "1-5";
const WEEKENDS_CRON_DOW = "0,6";
const MINUTE_FIELD_MAX = 59;
const HOUR_FIELD_MAX = 23;
const MONTH_FIELD_SIZE = 12;
const HOUR_FIELD_SIZE = 24;

const sortUnique = (values: readonly number[]): number[] =>
  memoBy(values, (value) => value).sort((a, b) => a - b);

export const compileScheduleAll = (schedule: AutomationSchedule): string[] => {
  switch (schedule.kind) {
    case "hourly":
      return [`${schedule.minute} * * * *`];
    case "daily":
      return [`${schedule.minute} ${schedule.hour} * * *`];
    case "timesOfDay": {
      const ordered = [...schedule.times].sort(
        (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
      );
      return memoBy(ordered, (time) => time.hour * 60 + time.minute).map(
        (time) => `${time.minute} ${time.hour} * * *`,
      );
    }
    case "weekdaysPreset":
      return [
        `${schedule.minute} ${schedule.hour} * * ${
          schedule.preset === "weekdays" ? WEEKDAYS_CRON_DOW : WEEKENDS_CRON_DOW
        }`,
      ];
    case "weekly":
      return [
        `${schedule.minute} ${schedule.hour} * * ${sortUnique(schedule.daysOfWeek).join(",")}`,
      ];
    case "monthly":
      return [
        `${schedule.minute} ${schedule.hour} ${sortUnique(schedule.daysOfMonth).join(",")} * *`,
      ];
    case "everyNMinutes":
      return [`*/${schedule.step} * * * *`];
    case "everyNHours":
      return [`${schedule.minute} */${schedule.step} * * *`];
    case "cron":
      return [schedule.expression.trim()];
    default: {
      const exhaustive: never = schedule;
      return exhaustive;
    }
  }
};

// The canonical cron for display/back-compat. For "timesOfDay" it is the
// earliest time's cron; the scheduler always reads compileScheduleAll().
export const compileSchedule = (schedule: AutomationSchedule): string =>
  compileScheduleAll(schedule)[0];

const numericSetEqual = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
};

const parsedCronEqual = (a: ParsedCronExpression, b: ParsedCronExpression): boolean =>
  numericSetEqual(a.minutes, b.minutes) &&
  numericSetEqual(a.hours, b.hours) &&
  numericSetEqual(a.daysOfMonth, b.daysOfMonth) &&
  numericSetEqual(a.months, b.months) &&
  numericSetEqual(a.daysOfWeek, b.daysOfWeek) &&
  a.isDayOfMonthRestricted === b.isDayOfMonthRestricted &&
  a.isDayOfWeekRestricted === b.isDayOfWeekRestricted;

// A set is a "*/step" expansion iff it is exactly {0, step, 2*step, …} over
// [0, max]. Returns the step, or null when the set is irregular.
const detectStep = (values: ReadonlySet<number>, max: number): number | null => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 2 || sorted[0] !== 0) return null;
  const step = sorted[1];
  if (step < 1) return null;
  const expected: number[] = [];
  for (let value = 0; value <= max; value += step) expected.push(value);
  if (expected.length !== sorted.length) return null;
  return expected.every((value, index) => value === sorted[index]) ? step : null;
};

const recognizeCandidate = (parsed: ParsedCronExpression): AutomationSchedule | null => {
  // Every preset keeps the month field wildcard; a restricted month stays cron.
  if (parsed.months.size !== MONTH_FIELD_SIZE) return null;
  const domWild = !parsed.isDayOfMonthRestricted;
  const dowWild = !parsed.isDayOfWeekRestricted;
  const hoursFull = parsed.hours.size === HOUR_FIELD_SIZE;

  // Multi-minute is only "every N minutes" (every hour, all day fields wild).
  if (parsed.minutes.size > 1) {
    if (!hoursFull || !domWild || !dowWild) return null;
    const step = detectStep(parsed.minutes, MINUTE_FIELD_MAX);
    return step === null ? null : { kind: "everyNMinutes", step };
  }

  const minute = [...parsed.minutes][0];

  // "every N hours": single minute, hours are a */step, all day fields wild.
  if (!hoursFull && parsed.hours.size > 1) {
    if (!domWild || !dowWild) return null;
    const step = detectStep(parsed.hours, HOUR_FIELD_MAX);
    return step === null ? null : { kind: "everyNHours", step, minute };
  }

  // Hourly: single minute, every hour, all day fields wild.
  if (hoursFull) {
    if (!domWild || !dowWild) return null;
    return { kind: "hourly", minute };
  }

  // Single specific hour from here on.
  if (parsed.hours.size !== 1) return null;
  const hour = [...parsed.hours][0];

  if (domWild && dowWild) return { kind: "daily", hour, minute };

  if (domWild && !dowWild) {
    const days = [...parsed.daysOfWeek].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
    if (days.length === 5 && days.every((day, index) => day === index + 1)) {
      return { kind: "weekdaysPreset", preset: "weekdays", hour, minute };
    }
    if (days.length === 2 && days[0] === 0 && days[1] === 6) {
      return { kind: "weekdaysPreset", preset: "weekends", hour, minute };
    }
    return days.length > 0 ? { kind: "weekly", daysOfWeek: days, hour, minute } : null;
  }

  if (!domWild && dowWild) {
    const days = [...parsed.daysOfMonth].sort((a, b) => a - b);
    return days.length > 0 ? { kind: "monthly", daysOfMonth: days, hour, minute } : null;
  }

  // Both day fields restricted -> Vixie OR semantics; no preset, stay cron.
  return null;
};

export const recognizePreset = (expression: string): AutomationSchedule | null => {
  const parsed = parseCronExpression(expression);
  if (!parsed) return null;
  const candidate = recognizeCandidate(parsed);
  if (!candidate) return null;
  // Parse-equality safety net: only single-cron candidates are recognized, so
  // the recompiled cron must re-parse set-equal to the original.
  const compiled = compileScheduleAll(candidate);
  if (compiled.length !== 1) return null;
  const recompiled = parseCronExpression(compiled[0]);
  return recompiled && parsedCronEqual(parsed, recompiled) ? candidate : null;
};

// Create/update/migration entry point: a bare cron string becomes a recognized
// preset (or {kind:"cron"}); a structured schedule is kept verbatim (an explicit
// {kind:"cron"} stays advanced — the caller chose the escape hatch).
export const normalizeScheduleInput = (input: AutomationSchedule | string): AutomationSchedule => {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  return recognizePreset(trimmed) ?? { kind: "cron", expression: trimmed };
};

// The trigger-level counterpart of normalizeScheduleInput: default watch's
// `recursive`, and normalize a schedule trigger's payload (recognizing a bare
// cron string as a friendly preset).
export const normalizeTriggerInput = (trigger: TriggerInput): AutomationTrigger =>
  trigger.kind === "watch"
    ? {
        kind: "watch",
        recursive: trigger.recursive ?? true,
        ...(trigger.filter ? { filter: trigger.filter } : {}),
      }
    : trigger.kind === "event"
      ? { kind: "event", events: trigger.events }
      : { kind: "schedule", schedule: normalizeScheduleInput(trigger.schedule) };
