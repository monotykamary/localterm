import type { AutomationRunRecord } from "@monotykamary/localterm-server/protocol";
import { cn } from "@/lib/utils";
import { findFirstFindingsLine } from "@/utils/find-first-findings-line";
import { formatAutomationRunTrigger } from "@/utils/format-automation-run-trigger";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { getAutomationRunTimestamp } from "@/utils/get-automation-run-timestamp";
import { runStatusBadge } from "@/utils/run-status-badge";
import { formatClockTime } from "@/utils/schedule-builder";

interface AutomationRunRowProps {
  run: AutomationRunRecord;
  nowMs: number;
  onOpenLog: (run: AutomationRunRecord) => void;
}

export const AutomationRunRow = ({ run, nowMs, onOpenLog }: AutomationRunRowProps) => {
  const badge = runStatusBadge(run.status, run.exitCode);
  const preview = findFirstFindingsLine(run.findings);
  const hasLog = Boolean(run.log || run.findings);
  return (
    <button
      type="button"
      onClick={() => onOpenLog(run)}
      disabled={!hasLog}
      className="flex w-full items-center gap-5 px-2.5 py-1.5 text-left text-xs outline-none transition-colors enabled:hover:bg-foreground/5 disabled:cursor-default"
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
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
        {run.status === "skipped"
          ? `was due ${formatClockTime(new Date(run.scheduledFor).getHours(), new Date(run.scheduledFor).getMinutes())} · machine off`
          : preview}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="min-w-[4.5rem] text-right text-[11px] text-muted-foreground/70">
          {formatAutomationRunTrigger(run.trigger)}
        </span>
        <span className="min-w-[4rem] text-right font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {formatRelativeTime(getAutomationRunTimestamp(run), nowMs)}
        </span>
      </span>
    </button>
  );
};
