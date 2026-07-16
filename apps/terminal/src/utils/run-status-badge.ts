import type {
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
      return { label: "launching…", className: "text-[var(--localterm-yellow)]" };
    case "running":
      return { label: "running…", className: "text-[var(--localterm-blue)]" };
    case "completed":
      return { label: "ok", className: "text-[var(--localterm-green)]" };
    case "failed":
      return {
        label: exitCode === null ? "failed" : `exit ${exitCode}`,
        className: "text-destructive",
      };
    case "missed":
      return { label: "missed", className: "text-muted-foreground" };
    case "skipped":
      return { label: "skipped", className: "text-[var(--localterm-yellow)]" };
    default: {
      const exhaustive: never = status;
      return { label: exhaustive, className: "text-muted-foreground" };
    }
  }
};

const FINISHED_BADGE: RunBadge = {
  label: "finished",
  className: "text-[var(--localterm-magenta)]",
};

export const lifecycleBadge = (lifecycle: AutomationLifecycle): RunBadge | null =>
  lifecycle === "finished" ? FINISHED_BADGE : null;
