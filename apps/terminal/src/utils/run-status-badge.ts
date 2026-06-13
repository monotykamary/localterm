import type {
  AutomationLastRun,
  AutomationLifecycle,
  AutomationRunStatus,
} from "@monotykamary/localterm-server/protocol";

export interface RunBadge {
  label: string;
  className: string;
}

// Tinted text (no fill) to match the terminal aesthetic and the diff-viewer
// status palette. Colors stay consistent across the list, history, and feed.
export const runStatusBadge = (status: AutomationRunStatus, exitCode: number | null): RunBadge => {
  switch (status) {
    case "launched":
      return { label: "launching…", className: "text-amber-400" };
    case "running":
      return { label: "running…", className: "text-sky-400" };
    case "completed":
      return { label: "ok", className: "text-emerald-400" };
    case "failed":
      return {
        label: exitCode === null ? "failed" : `exit ${exitCode}`,
        className: "text-red-400",
      };
    case "missed":
      return { label: "missed", className: "text-muted-foreground" };
    case "skipped":
      return { label: "skipped", className: "text-amber-400/70" };
    default: {
      const exhaustive: never = status;
      return { label: exhaustive, className: "text-muted-foreground" };
    }
  }
};

export const lastRunBadge = (lastRun: AutomationLastRun): RunBadge =>
  runStatusBadge(lastRun.status, lastRun.exitCode);

export const FINISHED_BADGE: RunBadge = { label: "finished", className: "text-violet-400" };

export const lifecycleBadge = (lifecycle: AutomationLifecycle): RunBadge | null =>
  lifecycle === "finished" ? FINISHED_BADGE : null;
