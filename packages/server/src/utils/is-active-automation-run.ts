import type { AutomationRunRecord } from "../types.js";

export const isActiveAutomationRun = (run: Pick<AutomationRunRecord, "status">): boolean =>
  run.status === "queued" || run.status === "launched" || run.status === "running";
