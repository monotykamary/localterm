const endpoint = (automationId: string, runId: string) =>
  `/api/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/read`;

export const markAutomationRunRead = async (
  automationId: string,
  runId: string,
): Promise<boolean> => {
  try {
    const response = await fetch(new URL(endpoint(automationId, runId), window.location.href), {
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
};
