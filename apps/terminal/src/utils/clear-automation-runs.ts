export const clearAutomationRuns = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(
      new URL(`/api/automations/${encodeURIComponent(id)}/clear-history`, window.location.href),
      { method: "POST" },
    );
    return response.ok;
  } catch {
    return false;
  }
};
