import type { AutomationRunWireRecord } from "@monotykamary/localterm-server/protocol";
import { cn } from "@/lib/utils";
import { findFirstFindingsLine } from "@/utils/find-first-findings-line";
import { formatAutomationRunTrigger } from "@/utils/format-automation-run-trigger";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { getAutomationRunTimestamp } from "@/utils/get-automation-run-timestamp";
import { runStatusBadge } from "@/utils/run-status-badge";
import { automationRunReason } from "@/utils/automation-run-reason";

interface AutomationRunRowProps {
  run: AutomationRunWireRecord;
  nowMs: number;
  onOpenLog: (run: AutomationRunWireRecord) => void;
}

export const AutomationRunRow = ({ run, nowMs, onOpenLog }: AutomationRunRowProps) => {
  const badge = runStatusBadge(run.status, run.exitCode);
  const preview = findFirstFindingsLine(run.findings);
  const hasLog = run.hasLog;
  return (
    <button
      type="button"
      onClick={() => onOpenLog(run)}
      disabled={!hasLog}
      className="flex w-full flex-wrap items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-foreground/5 disabled:cursor-default"
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
      <span className="min-w-0 flex-1 text-[11px] text-muted-foreground/80">
        {automationRunReason(run) ||
          preview ||
          (run.status === "skipped" ? "Not launched; reason unavailable for this older run." : "")}
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
