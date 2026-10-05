import type { AutomationWithNextRun } from "@monotykamary/localterm-server/protocol";
import { AUTOMATION_AGENDA_MAX_ROWS, AUTOMATION_AGENDA_WINDOW_MS } from "@/lib/constants";
import { scheduleOccurrences } from "@/utils/schedule-occurrences";

export const AGENDA_FILTERS = [
  "all",
  "scheduled",
  "active",
  "queued",
  "paused",
  "finished",
  "event-only",
] as const;
export type AgendaFilter = (typeof AGENDA_FILTERS)[number];
export const matchesAgendaFilter = (
  automation: AutomationWithNextRun,
  filter: AgendaFilter,
): boolean => {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return automation.runs.some((run) => run.status === "running" || run.status === "launched");
    case "queued":
      return automation.runs.some((run) => run.status === "queued");
    case "finished":
      return (
        automation.lifecycle === "finished" ||
        (automation.limit.kind === "count" && automation.runCount >= automation.limit.max)
      );
    case "paused":
      return !automation.enabled && !matchesAgendaFilter(automation, "finished");
    case "event-only":
      return automation.trigger.kind !== "schedule";
    case "scheduled":
      return (
        automation.trigger.kind === "schedule" &&
        automation.enabled &&
        !matchesAgendaFilter(automation, "finished")
      );
  }
};
export interface AgendaOccurrence {
  automation: AutomationWithNextRun;
  at: number;
}
interface AgendaCandidate extends AgendaOccurrence {
  remaining: number;
}
const compareOccurrences = (a: AgendaOccurrence, b: AgendaOccurrence): number =>
  a.at - b.at ||
  a.automation.cwd.localeCompare(b.automation.cwd) ||
  a.automation.name.localeCompare(b.automation.name);

export const automationAgenda = (automations: AutomationWithNextRun[], nowMs: number) => {
  const rows: AgendaOccurrence[] = [];
  const candidates: AgendaCandidate[] = [];
  const unknownZoneIds: string[] = [];
  const enqueueNext = (automation: AutomationWithNextRun, from: number, remaining: number) => {
    if (remaining <= 0 || automation.trigger.kind !== "schedule") return;
    const at = scheduleOccurrences(
      automation.trigger.schedule,
      from,
      automation.timezone,
      1,
      nowMs + AUTOMATION_AGENDA_WINDOW_MS,
    )[0];
    if (at !== undefined) candidates.push({ automation, at, remaining });
  };
  for (const automation of automations) {
    if (!matchesAgendaFilter(automation, "scheduled") || automation.trigger.kind !== "schedule")
      continue;
    if (!automation.timezone && automation.trigger.schedule.kind !== "interval") {
      unknownZoneIds.push(automation.id);
      continue;
    }
    enqueueNext(
      automation,
      nowMs,
      automation.limit.kind === "count"
        ? Math.max(0, automation.limit.max - automation.runCount)
        : Infinity,
    );
  }
  // Merge schedule streams rather than expanding a full week for every automation.
  while (candidates.length > 0 && rows.length < AUTOMATION_AGENDA_MAX_ROWS) {
    candidates.sort(compareOccurrences);
    const next = candidates.shift();
    if (!next) break;
    rows.push({ automation: next.automation, at: next.at });
    enqueueNext(next.automation, next.at, next.remaining - 1);
  }
  return { rows, truncated: candidates.length > 0, unknownZoneIds };
};
