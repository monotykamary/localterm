import { TRIAGE_WEEK_BAND_DAYS } from "@/lib/constants";

// Local start-of-day, `daysAgo` calendar days before `nowMs`. Uses Date
// arithmetic so daylight-saving jumps don't shift the boundary off midnight.
const startOfDayDaysAgo = (nowMs: number, daysAgo: number): number => {
  const date = new Date(nowMs);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

// Gmail-style temporal bands. A triage row sits in the band of its newest run:
// Today / Yesterday / This week (rolling TRIAGE_WEEK_BAND_DAYS, excluding today
// & yesterday) / Earlier.
export const triageDateBandLabel = (timestampMs: number, nowMs: number): string => {
  const todayStartMs = startOfDayDaysAgo(nowMs, 0);
  if (timestampMs >= todayStartMs) return "Today";
  const yesterdayStartMs = startOfDayDaysAgo(nowMs, 1);
  if (timestampMs >= yesterdayStartMs) return "Yesterday";
  const weekStartMs = startOfDayDaysAgo(nowMs, TRIAGE_WEEK_BAND_DAYS);
  if (timestampMs >= weekStartMs) return "This week";
  return "Earlier";
};
