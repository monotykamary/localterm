import {
  nextScheduleOccurrence,
  type AutomationSchedule,
} from "@monotykamary/localterm-server/protocol";

/** Bounded, strictly advancing occurrences from the same engine used by the daemon. */
export const scheduleOccurrences = (
  schedule: AutomationSchedule,
  from: number,
  timezone: string | undefined,
  count: number,
  until = Infinity,
): number[] => {
  const result: number[] = [];
  let cursor = from;
  for (let index = 0; index < count; index++) {
    const next = nextScheduleOccurrence(schedule, new Date(cursor), timezone);
    if (next === null || !Number.isFinite(next) || next <= cursor || next > until) break;
    result.push(next);
    cursor = next;
  }
  return result;
};
