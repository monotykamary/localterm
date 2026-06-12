const AUTOMATIONS_ENDPOINT = "/api/automations";

export const deleteAutomation = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(
      new URL(`${AUTOMATIONS_ENDPOINT}/${encodeURIComponent(id)}`, window.location.href),
      { method: "DELETE" },
    );
    return response.ok;
  } catch {
    return false;
  }
};
