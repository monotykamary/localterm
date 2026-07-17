import type { AutomationRunRecord } from "@monotykamary/localterm-server/protocol";

export const getAutomationRunTimestamp = (run: AutomationRunRecord): number =>
  run.finishedAt ?? run.startedAt ?? run.scheduledFor;
