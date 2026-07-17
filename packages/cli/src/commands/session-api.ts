import {
  daemonBaseUrl,
  daemonFetch,
  reportApiError,
  reportDaemonDown,
} from "../utils/daemon-api.js";

export const fetchSessionApi = async (path: string, init: RequestInit): Promise<Response | null> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    reportDaemonDown();
    process.exitCode = 1;
    return null;
  }
  const response = await daemonFetch(`${base}${path}`, init);
  if (!response.ok) {
    reportApiError(response.status, await response.text());
    process.exitCode = 1;
    return null;
  }
  return response;
};
