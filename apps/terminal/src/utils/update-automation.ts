import {
  automationWithNextRunSchema,
  type AutomationWithNextRun,
  type UpdateAutomationInput,
} from "@monotykamary/localterm-server/protocol";

const AUTOMATIONS_ENDPOINT = "/api/automations";

export const updateAutomation = async (
  id: string,
  patch: UpdateAutomationInput,
): Promise<AutomationWithNextRun | null> => {
  try {
    const response = await fetch(
      new URL(`${AUTOMATIONS_ENDPOINT}/${encodeURIComponent(id)}`, window.location.href),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
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
