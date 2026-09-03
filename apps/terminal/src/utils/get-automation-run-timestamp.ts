import type { AutomationRunWireRecord } from "@monotykamary/localterm-server/protocol";

export const getAutomationRunTimestamp = (run: AutomationRunWireRecord): number =>
  run.finishedAt ?? run.startedAt ?? run.scheduledFor;
