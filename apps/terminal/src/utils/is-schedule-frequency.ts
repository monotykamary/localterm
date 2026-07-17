import { SCHEDULE_FREQUENCIES, type ScheduleFrequency } from "@/utils/schedule-builder";

export const isScheduleFrequency = (value: string | null): value is ScheduleFrequency =>
  value !== null && SCHEDULE_FREQUENCIES.some((frequency) => frequency === value);
