import {
  automationsListResponseSchema,
  type AutomationWithNextRun,
} from "@monotykamary/localterm-server/protocol";

const AUTOMATIONS_ENDPOINT = "/api/automations";

export const fetchAutomations = async (
  signal?: AbortSignal,
): Promise<AutomationWithNextRun[] | null> => {
  try {
    const response = await fetch(new URL(AUTOMATIONS_ENDPOINT, window.location.href), { signal });
    if (!response.ok) return null;
    const parsed = automationsListResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.automations : null;
  } catch {
    return null;
  }
};
