import type { AutomationWithNextRun } from "@monotykamary/localterm-server/protocol";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AGENDA_FILTERS,
  automationAgenda,
  matchesAgendaFilter,
  type AgendaFilter,
  type AgendaOccurrence,
} from "@/utils/automation-agenda";
import { AUTOMATION_AGENDA_DAYS, AUTOMATION_AGENDA_MAX_ROWS } from "@/lib/constants";
import { formatScheduleInstant } from "@/utils/format-schedule-instant";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { cn } from "@/lib/utils";

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

interface Props {
  automations: AutomationWithNextRun[] | null;
  nowMs: number;
  error: boolean;
  onRetry: () => void;
  onSelect: (id: string) => void;
}

export const AutomationAgenda = ({ automations, nowMs, error, onRetry, onSelect }: Props) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AgendaFilter>("all");
  const matched = useMemo(
    () =>
      (automations ?? []).filter(
        (automation) =>
          matchesAgendaFilter(automation, filter) &&
          `${automation.name} ${automation.cwd}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [automations, search, filter],
  );
  const agenda = useMemo(() => automationAgenda(matched, nowMs), [matched, nowMs]);
  const days = new Map<string, Map<string, AgendaOccurrence[]>>();
  for (const row of agenda.rows) {
    const day = dayFormatter.format(row.at);
    const projects = days.get(day) ?? new Map<string, AgendaOccurrence[]>();
    projects.set(row.automation.cwd, [...(projects.get(row.automation.cwd) ?? []), row]);
    days.set(day, projects);
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-border/40 p-4">
        <div>
          <h3 className="text-sm font-medium">Upcoming · next {AUTOMATION_AGENDA_DAYS} days</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Calendar times shown in your local zone: {zone}. Grouped by day and project.
          </p>
        </div>
        <Input
          aria-label="search upcoming automations"
          placeholder="Search automations or project directories…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex flex-wrap gap-1" aria-label="upcoming filters">
          {AGENDA_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md border border-border/50 px-2 py-1 text-xs capitalize focus-visible:outline-2 focus-visible:outline-ring",
                filter === value
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5",
              )}
            >
              {value}{" "}
              <span className="tabular-nums">
                {automations === null
                  ? "—"
                  : automations.filter((automation) => matchesAgendaFilter(automation, value))
                      .length}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Times are planned, not guaranteed. Active and queued work is shown separately.
        </p>
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring">
            How this agenda works
          </summary>
          <p className="mt-2">
            Filters count automations; categories can overlap. Active and queued work is never
            counted as future launches. Paused, finished and event-only automations have no calendar
            entries. Remaining run limits apply. Queued automatic work can use that budget first.
            Manual runs never count toward it.
          </p>
        </details>
        {agenda.truncated ? (
          <p
            role="status"
            className="rounded-md border border-border/60 bg-foreground/5 px-3 py-2 text-[11px]"
          >
            Limited preview: only the earliest {AUTOMATION_AGENDA_MAX_ROWS} scheduled occurrences
            are shown, not the entire 7-day window. Narrow the search to see a particular
            automation.
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            Couldn’t refresh automations.{" "}
            {automations
              ? "Showing the last available snapshot."
              : "Check your connection and retry."}
            <Button variant="outline" size="xs" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : null}
        {automations === null ? (
          <p role="status" className="py-6 text-center text-xs text-muted-foreground">
            {error
              ? "Upcoming is unavailable until automations load."
              : "Loading upcoming automations…"}
          </p>
        ) : (
          <>
            {agenda.rows.length === 0 ? (
              <div
                role="status"
                className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground"
              >
                <p className="font-medium text-foreground">
                  {automations.length === 0
                    ? "No automations yet"
                    : matched.length === 0
                      ? "No matching automations"
                      : "No scheduled runs in the next 7 days"}
                </p>
                <p className="mt-1">
                  {automations.length === 0
                    ? "Create an automation in the Automations tab to plan your first run."
                    : matched.length === 0
                      ? "Try another search or choose All."
                      : "The next date may be outside this window, or these automations are paused, finished, event-only, or awaiting a server time zone."}
                </p>
                {search || filter !== "all" ? (
                  <Button
                    className="mt-2"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            ) : null}
            {matched.length > 0 ? (
              <details className="space-y-2" open={filter !== "all" && filter !== "scheduled"}>
                <summary className="cursor-pointer text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
                  Automation status · {matched.length} matching automations
                </summary>
                <div className="divide-y divide-border/30 rounded-lg border border-border/60">
                  {matched.slice(0, AUTOMATION_AGENDA_MAX_ROWS).map((automation) => (
                    <button
                      key={automation.id}
                      type="button"
                      onClick={() => onSelect(automation.id)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{automation.name}</span>
                        <span className="break-all text-[11px] text-muted-foreground">
                          {automation.cwd}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        {AGENDA_FILTERS.filter(
                          (value) => value !== "all" && matchesAgendaFilter(automation, value),
                        ).join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
                {matched.length > AUTOMATION_AGENDA_MAX_ROWS ? (
                  <p className="text-xs text-muted-foreground">
                    Showing {AUTOMATION_AGENDA_MAX_ROWS} matching automations. Narrow the search to
                    find others.
                  </p>
                ) : null}
              </details>
            ) : null}
            {[...days].map(([day, projects]) => (
              <section key={day} className="space-y-2">
                <h4 className="text-xs font-medium">{day}</h4>
                {[...projects].map(([project, rows]) => (
                  <div key={project} className="overflow-hidden rounded-lg border border-border/60">
                    <h5 className="break-all border-b border-border/40 bg-foreground/[0.02] px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {project}
                    </h5>
                    <ol className="divide-y divide-border/30">
                      {rows.map(({ automation, at }) => (
                        <li key={`${automation.id}:${at}`}>
                          <button
                            type="button"
                            onClick={() => onSelect(automation.id)}
                            aria-label={`open ${automation.name} scheduled ${new Date(at).toISOString()}`}
                            className="flex w-full flex-col gap-1 px-3 py-2 text-left text-xs hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <span className="flex flex-wrap justify-between gap-2">
                              <span className="font-medium">{automation.name}</span>
                              <span className="text-muted-foreground">
                                {formatRelativeTime(at, nowMs)}
                              </span>
                            </span>
                            <time dateTime={new Date(at).toISOString()}>
                              {formatScheduleInstant(at, zone)}
                            </time>
                            <span className="text-[11px] text-muted-foreground">
                              Schedule: {automation.timezone ?? "fixed elapsed interval"}
                              {automation.timezone && automation.timezone !== zone
                                ? ` · ${formatScheduleInstant(at, automation.timezone)}`
                                : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </section>
            ))}
            {agenda.truncated ? (
              <p role="status" className="text-xs text-muted-foreground">
                Showing the earliest {AUTOMATION_AGENDA_MAX_ROWS} occurrences. Narrow the search to
                see more of a particular automation.
              </p>
            ) : null}
            {agenda.unknownZoneIds.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {agenda.unknownZoneIds.length} legacy schedules need their server time zone before
                exact dates can be shown. Refresh or choose a time zone in the automation.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};
