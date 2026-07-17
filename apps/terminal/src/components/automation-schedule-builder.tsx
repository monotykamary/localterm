import { Clock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberStepper } from "@/components/number-stepper";
import { SettingsSelect } from "@/components/settings-select";
import { FORM_INPUT_CLASSES } from "@/lib/automation-form-styles";
import { cn } from "@/lib/utils";
import {
  formatClockTime,
  FREQUENCY_LABELS,
  HOUR_STEP_OPTIONS,
  MINUTE_STEP_OPTIONS,
  SCHEDULE_FREQUENCIES,
  WEEKDAY_NAMES,
  type ScheduleFormState,
} from "@/utils/schedule-builder";
import { isScheduleFrequency } from "@/utils/is-schedule-frequency";

interface ToggleChipProps {
  label: string;
  active: boolean;
  onToggle: () => void;
  ariaLabel: string;
  className?: string;
}

interface TimePickerProps {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}

interface AutomationScheduleBuilderProps {
  schedule: ScheduleFormState;
  onChange: (next: ScheduleFormState) => void;
}

const ToggleChip = ({
  label,
  active,
  onToggle,
  ariaLabel,
  className,
}: ToggleChipProps) => (
  <button
    type="button"
    aria-label={ariaLabel}
    aria-pressed={active}
    onClick={onToggle}
    className={cn(
      "flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums transition-colors",
      active
        ? "border-primary/50 bg-foreground/10 text-foreground"
        : "border-border/60 text-muted-foreground hover:text-foreground",
      className,
    )}
  >
    {label}
  </button>
);

const TimePicker = ({ hour, minute, onChange }: TimePickerProps) => (
  <div className="flex items-center gap-1.5">
    <Clock className="size-3 text-muted-foreground/70" aria-hidden="true" />
    <NumberStepper
      value={hour}
      min={0}
      max={23}
      step={1}
      ariaLabel="hour"
      decrementAriaLabel="earlier hour"
      incrementAriaLabel="later hour"
      formatDisplay={(value) => String(value).padStart(2, "0")}
      onValueChange={(value) => onChange(Math.min(23, Math.max(0, value)), minute)}
    />
    <span className="text-muted-foreground">:</span>
    <NumberStepper
      value={minute}
      min={0}
      max={59}
      step={1}
      ariaLabel="minute"
      decrementAriaLabel="earlier minute"
      incrementAriaLabel="later minute"
      formatDisplay={(value) => String(value).padStart(2, "0")}
      onValueChange={(value) => onChange(hour, Math.min(59, Math.max(0, value)))}
    />
    <span className="text-[10px] text-muted-foreground/70">{formatClockTime(hour, minute)}</span>
  </div>
);

export const AutomationScheduleBuilder = ({
  schedule,
  onChange,
}: AutomationScheduleBuilderProps) => {
  const frequencyItems = SCHEDULE_FREQUENCIES.map((key) => ({
    id: key,
    label: FREQUENCY_LABELS[key],
  }));
  const setTimeAt = (index: number, hour: number, minute: number) =>
    onChange({
      ...schedule,
      times: schedule.times.map((time, position) => (position === index ? { hour, minute } : time)),
    });
  return (
    <div className="flex flex-col gap-2">
      <SettingsSelect
        value={schedule.frequency}
        items={frequencyItems}
        ariaLabel="schedule frequency"
        placeholder="Frequency"
        onValueChange={(next) =>
          onChange({
            ...schedule,
            frequency: isScheduleFrequency(next) ? next : schedule.frequency,
          })
        }
      />

      {(schedule.frequency === "daily" ||
        schedule.frequency === "weekdays" ||
        schedule.frequency === "weekends" ||
        schedule.frequency === "weekly" ||
        schedule.frequency === "monthly") && (
        <TimePicker
          hour={schedule.hour}
          minute={schedule.minute}
          onChange={(hour, minute) => onChange({ ...schedule, hour, minute })}
        />
      )}

      {schedule.frequency === "hourly" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>At minute</span>
          <NumberStepper
            value={schedule.minute}
            min={0}
            max={59}
            step={1}
            ariaLabel="minute past the hour"
            decrementAriaLabel="earlier minute"
            incrementAriaLabel="later minute"
            formatDisplay={(value) => String(value).padStart(2, "0")}
            onValueChange={(value) =>
              onChange({ ...schedule, minute: Math.min(59, Math.max(0, value)) })
            }
          />
        </div>
      )}

      {schedule.frequency === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_NAMES.map((name, day) => (
            <ToggleChip
              key={name}
              label={name}
              ariaLabel={`toggle ${name}`}
              active={schedule.daysOfWeek.includes(day)}
              onToggle={() =>
                onChange({
                  ...schedule,
                  daysOfWeek: schedule.daysOfWeek.includes(day)
                    ? schedule.daysOfWeek.filter((value) => value !== day)
                    : [...schedule.daysOfWeek, day],
                })
              }
            />
          ))}
        </div>
      )}

      {schedule.frequency === "monthly" && (
        <div className="w-fit rounded-lg border border-border/40 bg-background/40 p-2">
          <div className="grid grid-cols-7 gap-1 justify-items-center">
            {WEEKDAY_NAMES.map((name) => (
              <div
                key={name}
                className="flex h-7 items-center justify-center text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60"
              >
                {name}
              </div>
            ))}
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <ToggleChip
                key={day}
                label={String(day)}
                ariaLabel={`toggle day ${day}`}
                active={schedule.daysOfMonth.includes(day)}
                onToggle={() =>
                  onChange({
                    ...schedule,
                    daysOfMonth: schedule.daysOfMonth.includes(day)
                      ? schedule.daysOfMonth.filter((value) => value !== day)
                      : [...schedule.daysOfMonth, day],
                  })
                }
                className="size-7 px-0"
              />
            ))}
          </div>
        </div>
      )}

      {schedule.frequency === "timesOfDay" && (
        <div className="flex flex-col gap-1.5">
          {schedule.times.map((time, index) => (
            <div key={index} className="flex items-center gap-2">
              <TimePicker
                hour={time.hour}
                minute={time.minute}
                onChange={(hour, minute) => setTimeAt(index, hour, minute)}
              />
              {schedule.times.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`remove time ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...schedule,
                      times: schedule.times.filter((_, position) => position !== index),
                    })
                  }
                >
                  <X />
                </Button>
              )}
            </div>
          ))}
          {schedule.times.length < 12 && (
            <Button
              variant="ghost"
              size="xs"
              className="w-fit"
              onClick={() =>
                onChange({ ...schedule, times: [...schedule.times, { hour: 12, minute: 0 }] })
              }
            >
              <Plus aria-hidden="true" /> Add time
            </Button>
          )}
        </div>
      )}

      {schedule.frequency === "everyNMinutes" && (
        <SettingsSelect
          value={String(schedule.stepMinutes)}
          items={MINUTE_STEP_OPTIONS.map((step) => ({
            id: String(step),
            label: step === 1 ? "Every minute" : `Every ${step} minutes`,
          }))}
          ariaLabel="minute interval"
          placeholder="Interval"
          onValueChange={(next) =>
            onChange({ ...schedule, stepMinutes: Number(next ?? schedule.stepMinutes) })
          }
        />
      )}

      {schedule.frequency === "everyNHours" && (
        <div className="flex flex-col gap-2">
          <SettingsSelect
            value={String(schedule.stepHours)}
            items={HOUR_STEP_OPTIONS.map((step) => ({
              id: String(step),
              label: step === 1 ? "Every hour" : `Every ${step} hours`,
            }))}
            ariaLabel="hour interval"
            placeholder="Interval"
            onValueChange={(next) =>
              onChange({ ...schedule, stepHours: Number(next ?? schedule.stepHours) })
            }
          />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>On the clock, at minute</span>
            <NumberStepper
              value={schedule.minute}
              min={0}
              max={59}
              step={1}
              ariaLabel="minute past the hour"
              decrementAriaLabel="earlier minute"
              incrementAriaLabel="later minute"
              formatDisplay={(value) => String(value).padStart(2, "0")}
              onValueChange={(value) =>
                onChange({ ...schedule, minute: Math.min(59, Math.max(0, value)) })
              }
            />
          </div>
        </div>
      )}

      {schedule.frequency === "cron" && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <Input
            value={schedule.cron}
            placeholder="0 9 * * mon-fri"
            aria-label="cron expression"
            className={cn(FORM_INPUT_CLASSES, "font-mono")}
            onChange={(event) => onChange({ ...schedule, cron: event.target.value })}
          />
          <span className="text-[10px]">minute hour day month weekday — or @daily, @weekly</span>
        </label>
      )}
    </div>
  );
};
