import { AUTOMATION_RUN_HISTORY_CAP } from "../constants.js";
import type { AutomationRunRecord } from "../types.js";
import { isActiveAutomationRun } from "./is-active-automation-run.js";

export const trimAutomationRuns = (runs: AutomationRunRecord[]): AutomationRunRecord[] => {
  let remaining = Math.max(
    0,
    AUTOMATION_RUN_HISTORY_CAP - runs.filter(isActiveAutomationRun).length,
  );
  return runs.filter((run) => isActiveAutomationRun(run) || remaining-- > 0);
};
