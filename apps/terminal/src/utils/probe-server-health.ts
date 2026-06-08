const SERVER_HEALTH_ENDPOINT = "/api/health";

export const probeServerHealth = async (): Promise<boolean> => {
  try {
    const response = await fetch(SERVER_HEALTH_ENDPOINT);
    return response.ok;
  } catch {
    return false;
  }
};
