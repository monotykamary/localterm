import {
  automationWithNextRunSchema,
  type AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";

const AUTOMATIONS_ENDPOINT = "/api/automations";

export const resetAutomation = async (
  id: string,
  clearHistory = false,
): Promise<AutomationWithNextRun | null> => {
  try {
    const response = await fetch(
      new URL(`${AUTOMATIONS_ENDPOINT}/${encodeURIComponent(id)}/reset`, window.location.href),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clearHistory }),
      },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = automationWithNextRunSchema.safeParse(
      body && typeof body === "object" ? Reflect.get(body, "automation") : null,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
