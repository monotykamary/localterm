const ENDPOINT = "/api/triage/mark-all-read";

export const markAllTriageRead = async (): Promise<boolean> => {
  try {
    const response = await fetch(new URL(ENDPOINT, window.location.href), { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
};
