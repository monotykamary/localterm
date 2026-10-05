import type { AutomationRunWireRecord } from "@monotykamary/localterm-server/protocol";

export const automationRunReason = (run: AutomationRunWireRecord): string | null => {
  switch (run.reason) {
    case "overlap":
      return "Another run was still busy.";
    case "superseded":
      return "Replaced by a newer waiting run.";
    case "downtime":
      return "The server was unavailable at the scheduled time.";
    case "disabled":
      return "The automation was paused.";
    case "limit":
      return "The run limit was reached.";
    case "restart":
      return "The server restarted; check the log before retrying.";
    case "capacity":
      return "Server capacity was unavailable.";
    case "launch-failed":
      return "Could not start. Check the command, directory and log.";
    case "cancelled":
      return "Waiting work was cancelled.";
    default:
      return run.status === "interrupted"
        ? "Execution was interrupted. Review before retrying; work may be incomplete."
        : run.status === "queued"
          ? "Waiting to launch; not running yet."
          : null;
  }
};
