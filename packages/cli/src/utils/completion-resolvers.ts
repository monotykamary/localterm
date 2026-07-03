import { COMPLETION_DAEMON_FETCH_TIMEOUT_MS } from "../constants.js";
import { daemonBaseUrl, daemonFetch } from "./daemon-api.js";

// Completion runs on every <Tab>, so these never throw or print: on a missing
// port file (daemon down), timeout, non-2xx, or parse failure they resolve []
// and the shell falls back to its default completion.

const fetchJsonWithTimeout = async (path: string): Promise<unknown | null> => {
  let base: string;
  try {
    base = daemonBaseUrl();
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMPLETION_DAEMON_FETCH_TIMEOUT_MS);
  try {
    const response = await daemonFetch(`${base}${path}`, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchSessionIds = async (): Promise<string[]> => {
  const body = (await fetchJsonWithTimeout("/sessions")) as { sessions?: { id: string }[] } | null;
  return body?.sessions?.map((session) => session.id) ?? [];
};

export const fetchSecretNames = async (): Promise<string[]> => {
  const body = (await fetchJsonWithTimeout("/secrets")) as {
    supported?: boolean;
    secrets?: { name: string }[];
  } | null;
  return body?.secrets?.map((secret) => secret.name) ?? [];
};

export const fetchProcessNames = async (): Promise<string[]> => {
  const body = (await fetchJsonWithTimeout("/processes")) as {
    processes?: { name: string }[];
  } | null;
  return body?.processes?.map((process) => process.name) ?? [];
};
