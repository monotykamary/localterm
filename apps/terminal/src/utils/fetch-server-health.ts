import { healthSchema, type CdpHealth } from "@monotykamary/localterm-server/protocol";

const SERVER_HEALTH_ENDPOINT = "/api/health";

export interface ServerHealth {
  sessions: number;
  cdp: CdpHealth;
}

export const fetchServerHealth = async (signal?: AbortSignal): Promise<ServerHealth | null> => {
  try {
    const response = await fetch(new URL(SERVER_HEALTH_ENDPOINT, window.location.href), {
      signal,
    });
    if (!response.ok) return null;
    const parsed = healthSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    return { sessions: parsed.data.sessions, cdp: parsed.data.cdp };
  } catch {
    return null;
  }
};
