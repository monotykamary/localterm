const AUTOMATIONS_ENDPOINT = "/api/automations";

export const triggerAutomationRun = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(
      new URL(`${AUTOMATIONS_ENDPOINT}/${encodeURIComponent(id)}/run`, window.location.href),
      { method: "POST" },
    );
    return response.ok;
  } catch {
    return false;
  }
};
