export const clearAutomationHistory = async (): Promise<boolean> => {
  try {
    const response = await fetch(new URL("/api/triage/clear-history", window.location.href), {
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
};
