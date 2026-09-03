import {
  automationRunLogResponseSchema,
  type AutomationRunLog,
} from "@monotykamary/localterm-server/protocol";

export const fetchAutomationRunLog = async (
  automationId: string,
  runId: string,
): Promise<AutomationRunLog | null> => {
  try {
    const url = new URL(
      `/api/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/log`,
      window.location.href,
    );
    const response = await fetch(url);
    if (!response.ok) return null;
    const parsed = automationRunLogResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.log : null;
  } catch {
    return null;
  }
};
