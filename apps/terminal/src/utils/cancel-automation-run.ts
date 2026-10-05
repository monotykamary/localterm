export const cancelAutomationRun = async (
  automationId: string,
  runId: string,
): Promise<"cancelled" | "not-queued" | "error"> => {
  try {
    const response = await fetch(
      new URL(
        `/api/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/cancel`,
        window.location.href,
      ),
      { method: "POST" },
    );
    if (response.status === 409) return "not-queued";
    return response.ok ? "cancelled" : "error";
  } catch {
    return "error";
  }
};
