import type {
  AutomationSchedule,
  AutomationSessionEvent,
  AutomationTrigger,
} from "@monotykamary/localterm-server/protocol";

// The friendly-builder frequencies. "weekdays"/"weekends" are the
// weekdaysPreset variants surfaced as first-class options; "cron" is the
// advanced escape hatch.
export type ScheduleFrequency =
  | "hourly"
  | "daily"
  | "timesOfDay"
  | "weekdays"
  | "weekends"
  | "weekly"
  | "monthly"
  | "everyNMinutes"
  | "everyNHours"
  | "cron";

export interface TimeOfDay {
  hour: number;
  minute: number;
}

// A superset of every kind's controls. Only the controls for the selected
// frequency are shown; the rest keep sensible defaults so switching back and
// forth never loses a value.
export interface ScheduleFormState {
  frequency: ScheduleFrequency;
  hour: number;
  minute: number;
  daysOfWeek: number[];
  daysOfMonth: number[];
  times: TimeOfDay[];
  stepMinutes: number;
  stepHours: number;
  cron: string;
}

// Step choices restricted to divisors so the cadence is uniform across the
// hour/day; non-divisor intervals remain reachable via the advanced cron field.
export const MINUTE_STEP_OPTIONS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30] as const;
export const HOUR_STEP_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const;

export const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  hourly: "Hourly",
  daily: "Daily",
  timesOfDay: "Multiple times a day",
  weekdays: "Weekdays (Mon–Fri)",
  weekends: "Weekends (Sat–Sun)",
  weekly: "Specific days of the week",
  monthly: "Days of the month",
  everyNMinutes: "Every N minutes",
  everyNHours: "Every N hours",
  cron: "Advanced (cron)",
};

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const defaultScheduleForm = (): ScheduleFormState => ({
  frequency: "daily",
  hour: 9,
  minute: 0,
  daysOfWeek: [1, 2, 3, 4, 5],
  daysOfMonth: [1],
  times: [
    { hour: 9, minute: 0 },
    { hour: 17, minute: 0 },
  ],
  stepMinutes: 15,
  stepHours: 4,
  cron: "",
});

const sortTimes = (times: readonly TimeOfDay[]): TimeOfDay[] =>
  [...times].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

export const buildScheduleFromForm = (form: ScheduleFormState): AutomationSchedule => {
  switch (form.frequency) {
    case "hourly":
      return { kind: "hourly", minute: form.minute };
    case "daily":
      return { kind: "daily", hour: form.hour, minute: form.minute };
    case "timesOfDay":
      return {
        kind: "timesOfDay",
        times: form.times.length > 0 ? form.times : [{ hour: form.hour, minute: form.minute }],
      };
    case "weekdays":
      return { kind: "weekdaysPreset", preset: "weekdays", hour: form.hour, minute: form.minute };
    case "weekends":
      return { kind: "weekdaysPreset", preset: "weekends", hour: form.hour, minute: form.minute };
    case "weekly":
      return {
        kind: "weekly",
        daysOfWeek: form.daysOfWeek.length > 0 ? form.daysOfWeek : [1],
        hour: form.hour,
        minute: form.minute,
      };
    case "monthly":
      return {
        kind: "monthly",
        daysOfMonth: form.daysOfMonth.length > 0 ? form.daysOfMonth : [1],
        hour: form.hour,
        minute: form.minute,
      };
    case "everyNMinutes":
      return { kind: "everyNMinutes", step: form.stepMinutes };
    case "everyNHours":
      return { kind: "everyNHours", step: form.stepHours, minute: form.minute };
    case "cron":
      return { kind: "cron", expression: form.cron.trim() };
    default: {
      const exhaustive: never = form.frequency;
      return { kind: "cron", expression: exhaustive };
    }
  }
};

// Map a stored schedule back onto the form so editing reopens on the matching
// frequency (cron variants land on "Advanced").
export const recognizeScheduleForm = (schedule: AutomationSchedule): ScheduleFormState => {
  const base = defaultScheduleForm();
  switch (schedule.kind) {
    case "hourly":
      return { ...base, frequency: "hourly", minute: schedule.minute };
    case "daily":
      return { ...base, frequency: "daily", hour: schedule.hour, minute: schedule.minute };
    case "timesOfDay":
      return { ...base, frequency: "timesOfDay", times: sortTimes(schedule.times) };
    case "weekdaysPreset":
      return {
        ...base,
        frequency: schedule.preset === "weekdays" ? "weekdays" : "weekends",
        hour: schedule.hour,
        minute: schedule.minute,
      };
    case "weekly":
      return {
        ...base,
        frequency: "weekly",
        daysOfWeek: [...schedule.daysOfWeek].sort((a, b) => a - b),
        hour: schedule.hour,
        minute: schedule.minute,
      };
    case "monthly":
      return {
        ...base,
        frequency: "monthly",
        daysOfMonth: [...schedule.daysOfMonth].sort((a, b) => a - b),
        hour: schedule.hour,
        minute: schedule.minute,
      };
    case "everyNMinutes":
      return { ...base, frequency: "everyNMinutes", stepMinutes: schedule.step };
    case "everyNHours":
      return {
        ...base,
        frequency: "everyNHours",
        stepHours: schedule.step,
        minute: schedule.minute,
      };
    case "cron":
      return { ...base, frequency: "cron", cron: schedule.expression };
    default: {
      const exhaustive: never = schedule;
      return exhaustive;
    }
  }
};

export const formatClockTime = (hour: number, minute: number): string => {
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
};

const ordinal = (value: number): string => {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
};

// A compact human-readable label for the list rows and detail header.
export const scheduleLabel = (schedule: AutomationSchedule): string => {
  switch (schedule.kind) {
    case "hourly":
      return `Hourly at :${String(schedule.minute).padStart(2, "0")}`;
    case "daily":
      return `Daily at ${formatClockTime(schedule.hour, schedule.minute)}`;
    case "timesOfDay":
      return `Daily at ${sortTimes(schedule.times)
        .map((time) => formatClockTime(time.hour, time.minute))
        .join(", ")}`;
    case "weekdaysPreset":
      return `${schedule.preset === "weekdays" ? "Weekdays" : "Weekends"} at ${formatClockTime(
        schedule.hour,
        schedule.minute,
      )}`;
    case "weekly":
      return `${[...schedule.daysOfWeek]
        .sort((a, b) => a - b)
        .map((day) => WEEKDAY_NAMES[day])
        .join(", ")} at ${formatClockTime(schedule.hour, schedule.minute)}`;
    case "monthly":
      return `Monthly on ${[...schedule.daysOfMonth]
        .sort((a, b) => a - b)
        .map(ordinal)
        .join(", ")} at ${formatClockTime(schedule.hour, schedule.minute)}`;
    case "everyNMinutes":
      return schedule.step === 1 ? "Every minute" : `Every ${schedule.step} minutes`;
    case "everyNHours":
      return `Every ${schedule.step === 1 ? "hour" : `${schedule.step} hours`} at :${String(
        schedule.minute,
      ).padStart(2, "0")}`;
    case "cron":
      return `Cron: ${schedule.expression}`;
    default: {
      const exhaustive: never = schedule;
      return exhaustive;
    }
  }
};

// A trigger is either a time-based schedule or a folder watch. The form keeps a
// full schedule sub-form plus the watch options so toggling between the two
// never loses either side's values.
export type TriggerType = AutomationTrigger["kind"];

export interface TriggerFormState {
  triggerType: TriggerType;
  schedule: ScheduleFormState;
  watchRecursive: boolean;
  watchFilter: string;
  eventName: AutomationSessionEvent;
}

export const SESSION_EVENT_LABELS: Record<AutomationSessionEvent, string> = {
  "git-dirty": "Git changes detected",
  "git-refs-change": "Git commit/push detected",
  notification: "Shell notification (OSC 9)",
  cwd: "Directory changed",
  foreground: "Foreground process changed",
  exit: "Shell exited",
};

export const SESSION_EVENT_DESCRIPTIONS: Record<AutomationSessionEvent, string> = {
  "git-dirty":
    "Fires on each prompt after the working tree changes — commits, checkouts, stashes, edits.",
  "git-refs-change":
    "Fires when git HEAD actually moves (commit, push, checkout, reset). No prompt-cycle noise — only real ref changes.",
  notification:
    "Fires when a shell command emits OSC 9 (printf '\\e]9;message\\a'). Use your own scripts as event sources.",
  cwd: "Fires when you cd into or out of the automation's directory.",
  foreground:
    "Fires when the foreground process changes (e.g. vim starts or stops) in the directory.",
  exit: "Fires when a shell session in the directory closes.",
};

export const SESSION_EVENTS: AutomationSessionEvent[] = [
  "git-dirty",
  "git-refs-change",
  "notification",
  "cwd",
  "foreground",
  "exit",
];

export const buildTriggerFromForm = (form: TriggerFormState): AutomationTrigger =>
  form.triggerType === "watch"
    ? {
        kind: "watch",
        recursive: form.watchRecursive,
        ...(form.watchFilter.trim() ? { filter: form.watchFilter.trim() } : {}),
      }
    : form.triggerType === "event"
      ? { kind: "event", event: form.eventName }
      : { kind: "schedule", schedule: buildScheduleFromForm(form.schedule) };

// Map a stored trigger back onto the form fields so editing reopens on the
// matching trigger type (the inactive side keeps sensible defaults).
export const recognizeTriggerForm = (trigger: AutomationTrigger): TriggerFormState =>
  trigger.kind === "watch"
    ? {
        triggerType: "watch",
        schedule: defaultScheduleForm(),
        watchRecursive: trigger.recursive,
        watchFilter: trigger.filter ?? "",
        eventName: "git-dirty",
      }
    : trigger.kind === "event"
      ? {
          triggerType: "event",
          schedule: defaultScheduleForm(),
          watchRecursive: true,
          watchFilter: "",
          eventName: trigger.event,
        }
      : {
          triggerType: "schedule",
          schedule: recognizeScheduleForm(trigger.schedule),
          watchRecursive: true,
          watchFilter: "",
          eventName: "git-dirty",
        };

// A compact human-readable label for the list rows and detail header.
export const triggerLabel = (trigger: AutomationTrigger): string =>
  trigger.kind === "watch"
    ? `When files change${trigger.filter ? ` matching ${trigger.filter}` : ""}${trigger.recursive ? " · subfolders" : ""}`
    : trigger.kind === "event"
      ? `On ${SESSION_EVENT_LABELS[trigger.event]}`
      : scheduleLabel(trigger.schedule);
