import {
  automationScheduleSchema,
  compileScheduleAll,
  isValidTimeZone,
  parseCronExpression,
} from "@monotykamary/localterm-server/protocol";
import { AUTOMATION_INTERVAL_MAX } from "@/lib/constants";
import { buildScheduleFromForm, type ScheduleFormState } from "@/utils/schedule-builder";

export const scheduleValidationError = (
  form: ScheduleFormState,
  timezone?: string,
): string | null => {
  if (timezone !== undefined && !isValidTimeZone(timezone))
    return "Enter a valid IANA time zone, such as Europe/London.";
  if (form.frequency === "interval") {
    if (
      !Number.isInteger(form.intervalEvery) ||
      form.intervalEvery < 1 ||
      form.intervalEvery > AUTOMATION_INTERVAL_MAX
    )
      return `Enter a whole interval from 1 to ${AUTOMATION_INTERVAL_MAX.toLocaleString("en-US")}.`;
    if (!Number.isFinite(form.intervalAnchorAt) || form.intervalAnchorAt < 0)
      return "Choose a valid start date and time.";
  }
  if (form.frequency === "weekly" && form.daysOfWeek.length === 0)
    return "Choose at least one weekday.";
  if (form.frequency === "monthly" && form.daysOfMonth.length === 0)
    return "Choose at least one day of the month.";
  const schedule = buildScheduleFromForm(form);
  if (!automationScheduleSchema.safeParse(schedule).success) return "Check the schedule values.";
  if (
    schedule.kind !== "interval" &&
    !compileScheduleAll(schedule).every((cron) => parseCronExpression(cron) !== null)
  )
    return "Enter a valid five-field cron expression.";
  return null;
};
