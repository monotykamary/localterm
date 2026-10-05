import type { AutomationWithNextRun } from "@monotykamary/localterm-server/protocol";
import { AUTOMATION_PREVIEW_COUNT } from "@/lib/constants";
import { scheduleOccurrences } from "@/utils/schedule-occurrences";
import { formatScheduleInstant } from "@/utils/format-schedule-instant";
import { formatRelativeTime } from "@/utils/format-relative-time";

interface Props {
  automation: AutomationWithNextRun;
  nowMs: number;
}
export const AutomationScheduleSummary = ({ automation, nowMs }: Props) => {
  const thread = automation.runner.kind === "agent" && automation.runner.sessionMode === "thread";
  const overlap =
    thread && automation.concurrencyPolicy === "allow"
      ? "queue-latest"
      : (automation.concurrencyPolicy ?? "skip");
  const remaining =
    automation.limit.kind === "count"
      ? Math.max(0, automation.limit.max - automation.runCount)
      : Infinity;
  const scheduled =
    automation.trigger.kind === "schedule" &&
    automation.enabled &&
    automation.lifecycle !== "finished" &&
    remaining > 0;
  const occurrences =
    scheduled &&
    automation.trigger.kind === "schedule" &&
    (automation.timezone || automation.trigger.schedule.kind === "interval")
      ? scheduleOccurrences(
          automation.trigger.schedule,
          nowMs,
          automation.timezone,
          Math.min(remaining, AUTOMATION_PREVIEW_COUNT),
        )
      : [];
  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-foreground/[0.02] p-3 text-xs">
      <h4 className="font-medium">When it runs & what happens if it can’t</h4>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Schedule time zone</dt>
          <dd className="mt-1 break-words">
            {automation.timezone ?? "Server local (legacy; exact zone not available)"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">If already busy</dt>
          <dd className="mt-1">
            {overlap === "skip"
              ? "Skip the new run; keep current work."
              : overlap === "queue-latest"
                ? "Wait, then run the latest. Only one waiting run is kept."
                : "Run alongside current work; runs may overlap."}
            {thread ? " Thread context is always serialized." : ""}
          </dd>
        </div>
        {automation.trigger.kind === "schedule" ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">After downtime</dt>
            <dd className="mt-1">
              {automation.missedRunPolicy === "run-latest"
                ? "Catch up once with the latest missed occurrence, subject to safety settings and limits."
                : "Skip missed times and wait for the next scheduled occurrence."}
            </dd>
          </div>
        ) : null}
      </dl>
      {automation.trigger.kind === "watch" || automation.trigger.kind === "event" ? (
        <p className="text-[11px] text-muted-foreground">
          Automatic file and session-event triggers are suppressed during active work to prevent
          feedback loops. Run now still follows the busy-run setting above.
        </p>
      ) : null}
      {automation.trigger.kind === "schedule" ? (
        <div className="border-t border-border/40 pt-2">
          <h5 className="mb-2 font-medium">Next scheduled opportunities</h5>
          {!scheduled ? (
            <p className="text-muted-foreground">
              {remaining === 0 || automation.lifecycle === "finished"
                ? "Finished — reset the run count to schedule more work."
                : "Paused — no scheduled launches until enabled."}
            </p>
          ) : occurrences.length > 0 ? (
            <ol className="space-y-2">
              {occurrences.map((at) => (
                <li key={at} className="flex flex-wrap justify-between gap-1">
                  <time dateTime={new Date(at).toISOString()}>
                    {formatScheduleInstant(at, automation.timezone)}
                  </time>
                  <span className="text-muted-foreground">{formatRelativeTime(at, nowMs)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground">
              {!automation.timezone
                ? "Refresh to obtain the server zone, or set a time zone to preview exact dates."
                : "No future occurrence found for this schedule."}
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            These are schedule times, not queued work or guaranteed launches. Busy runs, downtime
            and queued automatic work can change the remaining budget. Manual runs never count
            toward it.
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">
          Event-only — no predictable calendar date. Run now is separate from its trigger.
        </p>
      )}
    </section>
  );
};
