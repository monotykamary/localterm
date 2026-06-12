import { CRON_NEXT_OCCURRENCE_SCAN_LIMIT_DAYS } from "./constants.js";

export interface ParsedCronExpression {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>;
  isDayOfMonthRestricted: boolean;
  isDayOfWeekRestricted: boolean;
}

interface CronFieldDefinition {
  min: number;
  max: number;
  names?: Record<string, number>;
}

const MINUTE_FIELD: CronFieldDefinition = { min: 0, max: 59 };
const HOUR_FIELD: CronFieldDefinition = { min: 0, max: 23 };
const DAY_OF_MONTH_FIELD: CronFieldDefinition = { min: 1, max: 31 };
const MONTH_FIELD: CronFieldDefinition = {
  min: 1,
  max: 12,
  names: {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  },
};
const DAY_OF_WEEK_FIELD: CronFieldDefinition = {
  min: 0,
  max: 7,
  names: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 },
};
const SUNDAY_ALIAS = 7;
const SUNDAY = 0;
const CRON_FIELD_COUNT = 5;

const CRON_ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

const parseFieldValue = (text: string, definition: CronFieldDefinition): number | null => {
  if (definition.names) {
    const named = definition.names[text.toLowerCase()];
    if (named !== undefined) return named;
  }
  if (!/^\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  if (value < definition.min || value > definition.max) return null;
  return value;
};

const parseFieldPart = (part: string, definition: CronFieldDefinition): number[] | null => {
  const [rangeText, stepText, ...extraStepParts] = part.split("/");
  if (extraStepParts.length > 0) return null;
  let step = 1;
  if (stepText !== undefined) {
    if (!/^\d+$/.test(stepText)) return null;
    step = Number.parseInt(stepText, 10);
    if (step < 1) return null;
  }
  let start: number;
  let end: number;
  if (rangeText === "*") {
    start = definition.min;
    end = definition.max;
  } else {
    const [startText, endText, ...extraRangeParts] = rangeText.split("-");
    if (extraRangeParts.length > 0) return null;
    const startValue = parseFieldValue(startText, definition);
    if (startValue === null) return null;
    start = startValue;
    if (endText !== undefined) {
      const endValue = parseFieldValue(endText, definition);
      if (endValue === null) return null;
      end = endValue;
    } else {
      // Vixie cron treats a bare value with a step ("5/15") as "5 to max".
      end = stepText !== undefined ? definition.max : startValue;
    }
  }
  if (start > end) return null;
  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
};

const parseField = (fieldText: string, definition: CronFieldDefinition): Set<number> | null => {
  if (!fieldText) return null;
  const values = new Set<number>();
  for (const part of fieldText.split(",")) {
    const partValues = parseFieldPart(part, definition);
    if (partValues === null) return null;
    for (const value of partValues) {
      values.add(value);
    }
  }
  return values;
};

export const parseCronExpression = (expression: string): ParsedCronExpression | null => {
  const trimmed = expression.trim();
  const resolved = CRON_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  const fieldTexts = resolved.split(/\s+/);
  if (fieldTexts.length !== CRON_FIELD_COUNT) return null;
  const [minuteText, hourText, dayOfMonthText, monthText, dayOfWeekText] = fieldTexts;
  const minutes = parseField(minuteText, MINUTE_FIELD);
  const hours = parseField(hourText, HOUR_FIELD);
  const daysOfMonth = parseField(dayOfMonthText, DAY_OF_MONTH_FIELD);
  const months = parseField(monthText, MONTH_FIELD);
  const daysOfWeek = parseField(dayOfWeekText, DAY_OF_WEEK_FIELD);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;
  if (daysOfWeek.has(SUNDAY_ALIAS)) daysOfWeek.add(SUNDAY);
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    isDayOfMonthRestricted: !dayOfMonthText.startsWith("*"),
    isDayOfWeekRestricted: !dayOfWeekText.startsWith("*"),
  };
};

// Vixie cron day semantics: when both day fields are restricted the date
// matches if EITHER does; a wildcard field defers entirely to the other.
const cronMatchesDay = (parsed: ParsedCronExpression, date: Date): boolean => {
  const dayOfMonthMatches = parsed.daysOfMonth.has(date.getDate());
  const dayOfWeekMatches = parsed.daysOfWeek.has(date.getDay());
  if (parsed.isDayOfMonthRestricted && parsed.isDayOfWeekRestricted) {
    return dayOfMonthMatches || dayOfWeekMatches;
  }
  return dayOfMonthMatches && dayOfWeekMatches;
};

export const cronMatchesDate = (parsed: ParsedCronExpression, date: Date): boolean =>
  parsed.minutes.has(date.getMinutes()) &&
  parsed.hours.has(date.getHours()) &&
  parsed.months.has(date.getMonth() + 1) &&
  cronMatchesDay(parsed, date);

export const nextCronOccurrence = (parsed: ParsedCronExpression, from: Date): Date | null => {
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  const scanLimit = new Date(from.getTime());
  scanLimit.setDate(scanLimit.getDate() + CRON_NEXT_OCCURRENCE_SCAN_LIMIT_DAYS);
  while (candidate.getTime() <= scanLimit.getTime()) {
    if (!parsed.months.has(candidate.getMonth() + 1) || !cronMatchesDay(parsed, candidate)) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.hours.has(candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minutes.has(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1);
      continue;
    }
    return candidate;
  }
  return null;
};
