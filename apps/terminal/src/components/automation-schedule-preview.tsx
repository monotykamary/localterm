import { useId } from "react";
import { isValidTimeZone } from "@monotykamary/localterm-server/protocol";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AutomationFormState } from "@/lib/automation-form-state";
import { FORM_INPUT_CLASSES } from "@/lib/automation-form-styles";
import { AUTOMATION_PREVIEW_COUNT } from "@/lib/constants";
import { buildScheduleFromForm } from "@/utils/schedule-builder";
import { scheduleOccurrences } from "@/utils/schedule-occurrences";
import { scheduleValidationError } from "@/utils/schedule-validation-error";
import { formatScheduleInstant } from "@/utils/format-schedule-instant";
import { formatRelativeTime } from "@/utils/format-relative-time";

interface Props {
  form: AutomationFormState;
  onChange: (next: AutomationFormState) => void;
  nowMs: number;
}

export const AutomationSchedulePreview = ({ form, onChange, nowMs }: Props) => {
  const id = useId();
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [
    ...new Set(
      [
        form.timezone,
        localZone,
        "UTC",
        ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []),
      ].filter((zone): zone is string => Boolean(zone)),
    ),
  ];
  const error = scheduleValidationError(form.schedule, form.timezone);
  const finished = form.lifecycle === "finished";
  const isInterval = form.schedule.frequency === "interval";
  const remaining =
    form.limitMode === "count" ? Math.max(0, form.limitMax - (form.runCount ?? 0)) : Infinity;
  const occurrences =
    !finished && !error && (form.timezone || isInterval)
      ? scheduleOccurrences(
          buildScheduleFromForm(form.schedule),
          nowMs,
          form.timezone,
          Math.min(remaining, AUTOMATION_PREVIEW_COUNT),
        )
      : [];
  return (
    <div className="flex flex-col gap-2 text-xs">
      <label htmlFor={id} className="text-muted-foreground">
        Schedule time zone
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          list={`${id}-zones`}
          value={form.timezone ?? ""}
          placeholder="Server local (legacy)"
          aria-invalid={form.timezone !== undefined && !isValidTimeZone(form.timezone)}
          aria-describedby={`${id}-help`}
          className={`${FORM_INPUT_CLASSES} min-w-0 flex-1`}
          onChange={(event) => onChange({ ...form, timezone: event.target.value })}
        />
        <Button
          size="xs"
          variant="outline"
          onClick={() => onChange({ ...form, timezone: localZone })}
        >
          Use my zone
        </Button>
        <datalist id={`${id}-zones`}>
          {zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </div>
      <p id={`${id}-help`} className="text-[11px] text-muted-foreground">
        Your browser: {localZone}. Calendar schedules follow the selected zone, including daylight
        saving. Fixed intervals measure elapsed time.
      </p>
      <div
        className="rounded-lg border border-border/60 bg-foreground/[0.02] p-3"
        aria-live="polite"
      >
        <h4 className="mb-2 font-medium">Next scheduled times</h4>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : finished ? (
          <p className="text-muted-foreground">
            Finished — saving a higher limit does not resume this automation. Save your changes,
            then use Reset in its detail view.
          </p>
        ) : !form.timezone && !isInterval ? (
          <p className="text-muted-foreground">
            Uses the server’s local zone. Select a zone to preview exact times; leaving this
            unchanged preserves the legacy setting.
          </p>
        ) : occurrences.length === 0 ? (
          <p className="text-muted-foreground">
            {remaining === 0
              ? "Run budget exhausted — increase the limit to allow more scheduled work."
              : "No next occurrence found. Check the calendar dates or cron expression."}
          </p>
        ) : (
          <ol className="space-y-2">
            {occurrences.map((at) => (
              <li key={at} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <time dateTime={new Date(at).toISOString()}>
                  {formatScheduleInstant(at, form.timezone ?? localZone)}
                </time>
                <span className="text-muted-foreground">{formatRelativeTime(at, nowMs)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {form.timezone
            ? `Schedule zone: ${form.timezone}. `
            : isInterval
              ? `Display zone: browser local (${localZone}). Fixed intervals do not depend on a time zone. `
              : ""}
          {finished
            ? "No automatic launches are planned until Reset."
            : form.enabled
              ? "Preview, not a launch guarantee. Busy runs, downtime and the remaining run limit can change what launches."
              : "Paused — these times are a preview only. Nothing will launch until enabled."}
        </p>
      </div>
    </div>
  );
};
