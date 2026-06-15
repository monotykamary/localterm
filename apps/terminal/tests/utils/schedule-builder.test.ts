import type {
  AutomationSchedule,
  AutomationTrigger,
} from "@monotykamary/localterm-server/protocol";
import { describe, expect, it } from "vite-plus/test";
import {
  buildScheduleFromForm,
  buildTriggerFromForm,
  defaultScheduleForm,
  recognizeScheduleForm,
  recognizeTriggerForm,
  scheduleLabel,
  triggerLabel,
  type ScheduleFormState,
  type TriggerFormState,
} from "../../src/utils/schedule-builder";

const withForm = (overrides: Partial<ScheduleFormState>): ScheduleFormState => ({
  ...defaultScheduleForm(),
  ...overrides,
});

describe("buildScheduleFromForm", () => {
  it("builds the structured schedule for each frequency", () => {
    expect(buildScheduleFromForm(withForm({ frequency: "hourly", minute: 15 }))).toEqual({
      kind: "hourly",
      minute: 15,
    });
    expect(buildScheduleFromForm(withForm({ frequency: "daily", hour: 9, minute: 30 }))).toEqual({
      kind: "daily",
      hour: 9,
      minute: 30,
    });
    expect(buildScheduleFromForm(withForm({ frequency: "weekdays", hour: 8, minute: 0 }))).toEqual({
      kind: "weekdaysPreset",
      preset: "weekdays",
      hour: 8,
      minute: 0,
    });
    expect(buildScheduleFromForm(withForm({ frequency: "weekends", hour: 8, minute: 0 }))).toEqual({
      kind: "weekdaysPreset",
      preset: "weekends",
      hour: 8,
      minute: 0,
    });
    expect(
      buildScheduleFromForm(
        withForm({ frequency: "weekly", daysOfWeek: [1, 3], hour: 8, minute: 0 }),
      ),
    ).toEqual({ kind: "weekly", daysOfWeek: [1, 3], hour: 8, minute: 0 });
    expect(
      buildScheduleFromForm(
        withForm({ frequency: "monthly", daysOfMonth: [1, 15], hour: 0, minute: 0 }),
      ),
    ).toEqual({ kind: "monthly", daysOfMonth: [1, 15], hour: 0, minute: 0 });
    expect(buildScheduleFromForm(withForm({ frequency: "everyNMinutes", stepMinutes: 5 }))).toEqual(
      {
        kind: "everyNMinutes",
        step: 5,
      },
    );
    expect(
      buildScheduleFromForm(withForm({ frequency: "everyNHours", stepHours: 6, minute: 0 })),
    ).toEqual({ kind: "everyNHours", step: 6, minute: 0 });
    expect(buildScheduleFromForm(withForm({ frequency: "cron", cron: " 0 9 * * 1-5 " }))).toEqual({
      kind: "cron",
      expression: "0 9 * * 1-5",
    });
    expect(
      buildScheduleFromForm(withForm({ frequency: "timesOfDay", times: [{ hour: 9, minute: 0 }] })),
    ).toEqual({ kind: "timesOfDay", times: [{ hour: 9, minute: 0 }] });
  });
});

describe("recognizeScheduleForm", () => {
  const schedules: AutomationSchedule[] = [
    { kind: "hourly", minute: 15 },
    { kind: "daily", hour: 9, minute: 30 },
    { kind: "weekdaysPreset", preset: "weekdays", hour: 8, minute: 0 },
    { kind: "weekdaysPreset", preset: "weekends", hour: 8, minute: 0 },
    { kind: "weekly", daysOfWeek: [1, 3, 5], hour: 8, minute: 0 },
    { kind: "monthly", daysOfMonth: [1, 15], hour: 0, minute: 0 },
    { kind: "everyNMinutes", step: 5 },
    { kind: "everyNHours", step: 6, minute: 0 },
    {
      kind: "timesOfDay",
      times: [
        { hour: 9, minute: 0 },
        { hour: 17, minute: 0 },
      ],
    },
    { kind: "cron", expression: "0 9 1 * 1" },
  ];

  it("round-trips every schedule through the form", () => {
    for (const schedule of schedules) {
      expect(buildScheduleFromForm(recognizeScheduleForm(schedule))).toEqual(schedule);
    }
  });
});

describe("scheduleLabel", () => {
  it("renders friendly labels", () => {
    expect(scheduleLabel({ kind: "daily", hour: 9, minute: 0 })).toBe("Daily at 9:00 AM");
    expect(scheduleLabel({ kind: "daily", hour: 14, minute: 30 })).toBe("Daily at 2:30 PM");
    expect(scheduleLabel({ kind: "weekdaysPreset", preset: "weekdays", hour: 9, minute: 0 })).toBe(
      "Weekdays at 9:00 AM",
    );
    expect(scheduleLabel({ kind: "everyNMinutes", step: 15 })).toBe("Every 15 minutes");
    expect(scheduleLabel({ kind: "monthly", daysOfMonth: [1, 2], hour: 0, minute: 0 })).toContain(
      "1st, 2nd",
    );
    expect(scheduleLabel({ kind: "cron", expression: "*/5 * * * *" })).toBe("Cron: */5 * * * *");
  });
});

const withTrigger = (overrides: Partial<TriggerFormState>): TriggerFormState => ({
  triggerType: "schedule",
  schedule: defaultScheduleForm(),
  watchRecursive: true,
  watchFilter: "",
  eventName: "git-dirty",
  ...overrides,
});

describe("buildTriggerFromForm", () => {
  it("builds a schedule trigger from the schedule sub-form", () => {
    expect(
      buildTriggerFromForm(
        withTrigger({ schedule: { ...defaultScheduleForm(), frequency: "hourly", minute: 15 } }),
      ),
    ).toEqual({ kind: "schedule", schedule: { kind: "hourly", minute: 15 } });
  });

  it("builds a watch trigger carrying the recursive flag", () => {
    expect(
      buildTriggerFromForm(withTrigger({ triggerType: "watch", watchRecursive: false })),
    ).toEqual({ kind: "watch", recursive: false });
  });

  it("omits filter from a watch trigger when the field is empty", () => {
    expect(buildTriggerFromForm(withTrigger({ triggerType: "watch", watchFilter: "" }))).toEqual({
      kind: "watch",
      recursive: true,
    });
  });

  it("includes filter in a watch trigger when the field is set", () => {
    expect(
      buildTriggerFromForm(withTrigger({ triggerType: "watch", watchFilter: "*.mov" })),
    ).toEqual({ kind: "watch", recursive: true, filter: "*.mov" });
  });

  it("builds an event trigger carrying the event name", () => {
    expect(
      buildTriggerFromForm(withTrigger({ triggerType: "event", eventName: "notification" })),
    ).toEqual({ kind: "event", event: "notification" });
  });
});

describe("recognizeTriggerForm", () => {
  const triggers: AutomationTrigger[] = [
    { kind: "schedule", schedule: { kind: "daily", hour: 9, minute: 30 } },
    { kind: "watch", recursive: true },
    { kind: "watch", recursive: false },
    { kind: "watch", recursive: true, filter: "*.mov" },
    { kind: "event", event: "git-dirty" },
    { kind: "event", event: "git-refs-change" },
    { kind: "event", event: "notification" },
  ];

  it("round-trips every trigger through the form", () => {
    for (const trigger of triggers) {
      expect(buildTriggerFromForm(recognizeTriggerForm(trigger))).toEqual(trigger);
    }
  });
});

describe("triggerLabel", () => {
  it("labels schedule and watch triggers", () => {
    expect(
      triggerLabel({ kind: "schedule", schedule: { kind: "daily", hour: 9, minute: 0 } }),
    ).toBe("Daily at 9:00 AM");
    expect(triggerLabel({ kind: "watch", recursive: true })).toBe("When files change · subfolders");
    expect(triggerLabel({ kind: "watch", recursive: false })).toBe("When files change");
    expect(triggerLabel({ kind: "watch", recursive: true, filter: "*.mov" })).toBe(
      "When files change matching *.mov · subfolders",
    );
    expect(triggerLabel({ kind: "watch", recursive: false, filter: "*.mov" })).toBe(
      "When files change matching *.mov",
    );
    expect(triggerLabel({ kind: "event", event: "git-dirty" })).toBe("On Git changes detected");
    expect(triggerLabel({ kind: "event", event: "git-refs-change" })).toBe("On Git commit/push detected");
    expect(triggerLabel({ kind: "event", event: "notification" })).toBe(
      "On Shell notification (OSC 9)",
    );
  });
});
