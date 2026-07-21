import type {
  AutomationRunRecord,
  AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";
import { ArrowUpRight, ChevronDown, Eraser } from "lucide-react";
import { useMemo, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SECTION_LABEL_CLASSES } from "@/lib/automation-form-styles";
import { cn } from "@/lib/utils";
import { findFirstFindingsLine } from "@/utils/find-first-findings-line";
import { formatAutomationRunTrigger } from "@/utils/format-automation-run-trigger";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { getAutomationRunTimestamp } from "@/utils/get-automation-run-timestamp";
import { groupTriageRuns } from "@/utils/group-triage-runs";
import { runStatusBadge } from "@/utils/run-status-badge";

const TRIAGE_FILTERS = ["all", "unread", "failed", "skipped"] as const;
type TriageFilter = (typeof TRIAGE_FILTERS)[number];

interface AutomationRecentRun {
  automation: AutomationWithNextRun;
  run: AutomationRunRecord;
}

interface TriageRunRowProps {
  automation: AutomationWithNextRun;
  run: AutomationRunRecord;
  nowMs: number;
  onOpenLog: (automationId: string, run: AutomationRunRecord) => void;
  onSelect: (automationId: string, run: AutomationRunRecord) => void;
}

interface TriageThreadRowProps {
  automation: AutomationWithNextRun;
  runs: AutomationRunRecord[];
  latestTimestamp: number;
  unreadCount: number;
  nowMs: number;
  onOpenLog: (automationId: string, run: AutomationRunRecord) => void;
  onSelect: (automationId: string, run: AutomationRunRecord) => void;
}

interface AutomationRecentRunsViewProps {
  runs: AutomationRecentRun[];
  nowMs: number;
  filter: TriageFilter;
  onFilterChange: (filter: TriageFilter) => void;
  onSelect: (automationId: string, run: AutomationRunRecord) => void;
  onOpenLog: (automationId: string, run: AutomationRunRecord) => void;
  onMarkAllRead: () => void;
  onClearHistory: () => void;
}

const TriageRunRow = ({ automation, run, nowMs, onOpenLog, onSelect }: TriageRunRowProps) => {
  const badge = runStatusBadge(run.status, run.exitCode);
  const findingsPreview = findFirstFindingsLine(run.findings);
  return (
    <div className="flex items-center gap-3 rounded-sm px-2.5 py-1.5 text-xs transition-colors hover:bg-foreground/5">
      <button
        type="button"
        aria-label={`open ${automation.name} run log`}
        title="Open run log"
        onClick={() => onOpenLog(automation.id, run)}
        className="flex min-w-0 flex-1 items-center gap-5 text-left outline-none"
      >
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn("size-1.5 rounded-full", run.unread ? "bg-foreground" : "bg-transparent")}
            aria-hidden="true"
          />
          <span className={cn("font-mono text-[10px] tabular-nums", badge.className)}>
            {badge.label}
          </span>
        </span>
        <span className="min-w-0 shrink-0 truncate text-foreground/90">{automation.name}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
          {findingsPreview}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="min-w-[4.5rem] text-right text-[11px] text-muted-foreground/70">
            {formatAutomationRunTrigger(run.trigger)}
          </span>
          <span className="min-w-[4rem] text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {formatRelativeTime(getAutomationRunTimestamp(run), nowMs)}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`open ${automation.name} automation`}
        title="Open automation"
        onClick={() => onSelect(automation.id, run)}
        className="shrink-0 rounded-sm text-muted-foreground/60 outline-none transition-colors hover:text-foreground"
      >
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};

const TriageThreadRow = ({
  automation,
  runs,
  latestTimestamp,
  unreadCount,
  nowMs,
  onOpenLog,
  onSelect,
}: TriageThreadRowProps) => {
  const latestRun = runs[0];
  const [open, setOpen] = useState(unreadCount > 0);
  const badge = runStatusBadge(latestRun.status, latestRun.exitCode);
  const findingsPreview = findFirstFindingsLine(latestRun.findings);
  const hasUnread = unreadCount > 0;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-sm">
      <div className="flex items-center gap-3 px-2.5 py-1.5 text-xs transition-colors hover:bg-foreground/5">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              title={open ? "Collapse thread" : "Expand thread"}
              aria-label={`${automation.name}, ${runs.length} runs${hasUnread ? `, ${unreadCount} unread` : ""}`}
              className="group flex min-w-0 flex-1 items-center gap-5 text-left outline-none"
            />
          }
        >
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                hasUnread ? "bg-foreground" : "bg-transparent",
              )}
              aria-hidden="true"
            />
            <span className={cn("font-mono text-[10px] tabular-nums", badge.className)}>
              {badge.label}
            </span>
          </span>
          <span
            className={cn(
              "min-w-0 shrink-0 truncate",
              hasUnread ? "font-medium text-foreground" : "text-foreground/90",
            )}
          >
            {automation.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
            {findingsPreview}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-right text-[11px] tabular-nums text-muted-foreground/70">
              {runs.length} runs
              {hasUnread ? <span className="text-foreground"> · {unreadCount} unread</span> : null}
            </span>
            <span className="min-w-[4rem] text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatRelativeTime(latestTimestamp, nowMs)}
            </span>
            <ChevronDown
              className="size-3 text-muted-foreground/70 transition-transform group-data-[panel-open]:rotate-180"
              aria-hidden="true"
            />
          </span>
        </CollapsibleTrigger>
        <button
          type="button"
          aria-label={`open ${automation.name} automation`}
          title="Open automation"
          onClick={() => onSelect(automation.id, latestRun)}
          className="shrink-0 rounded-sm text-muted-foreground/60 outline-none transition-colors hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <CollapsibleContent>
        <div className="ml-3 border-l border-border/40">
          {runs.map((run) => (
            <TriageRunRow
              key={`${automation.id}:${run.runId}`}
              automation={automation}
              run={run}
              nowMs={nowMs}
              onOpenLog={onOpenLog}
              onSelect={onSelect}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const AutomationRecentRunsView = ({
  runs,
  nowMs,
  filter,
  onFilterChange,
  onSelect,
  onOpenLog,
  onMarkAllRead,
  onClearHistory,
}: AutomationRecentRunsViewProps) => {
  const hasUnread = runs.some(({ run }) => run.unread);
  const [armedClear, setArmedClear] = useState(false);
  const sections = useMemo(() => groupTriageRuns(runs, nowMs), [runs, nowMs]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-3 py-2">
        {TRIAGE_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilterChange(value)}
            className={cn(
              "rounded-sm px-2 py-0.5 text-[11px] capitalize transition-colors",
              filter === value
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value}
          </button>
        ))}
        {hasUnread ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="ml-auto rounded-sm px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Mark all read
          </button>
        ) : null}
        {runs.length > 0 ? (
          <button
            type="button"
            aria-label={armedClear ? "confirm clear all run history" : "clear all run history"}
            title={
              armedClear
                ? "Click again to confirm"
                : "Clear all run history (keeps the automations)"
            }
            className={cn(
              "rounded-sm px-2 py-0.5 text-[11px] transition-colors",
              armedClear
                ? "text-destructive hover:bg-destructive/10"
                : "text-muted-foreground hover:text-foreground",
              hasUnread ? "ml-1" : "ml-auto",
            )}
            onClick={() => {
              if (!armedClear) {
                setArmedClear(true);
                return;
              }
              setArmedClear(false);
              onClearHistory();
            }}
          >
            <Eraser className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {sections.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No runs to show.</p>
        ) : (
          sections.map((section) => (
            <div key={section.label}>
              <div className={cn(SECTION_LABEL_CLASSES, "px-2.5 pb-1 pt-2")}>{section.label}</div>
              {section.rows.map((row) =>
                row.kind === "thread" ? (
                  <TriageThreadRow
                    key={`thread:${row.automation.id}`}
                    automation={row.automation}
                    runs={row.runs}
                    latestTimestamp={row.latestTimestamp}
                    unreadCount={row.unreadCount}
                    nowMs={nowMs}
                    onOpenLog={onOpenLog}
                    onSelect={onSelect}
                  />
                ) : (
                  <TriageRunRow
                    key={`inline:${row.automation.id}:${row.run.runId}`}
                    automation={row.automation}
                    run={row.run}
                    nowMs={nowMs}
                    onOpenLog={onOpenLog}
                    onSelect={onSelect}
                  />
                ),
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
