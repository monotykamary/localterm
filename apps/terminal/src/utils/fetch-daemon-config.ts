import { daemonConfigSchema, type DaemonConfig } from "@monotykamary/localterm-server/protocol";

const CONFIG_ENDPOINT = "/api/config";

export const fetchDaemonConfig = async (signal?: AbortSignal): Promise<DaemonConfig | null> => {
  try {
    const response = await fetch(new URL(CONFIG_ENDPOINT, window.location.href), { signal });
    if (!response.ok) return null;
    const parsed = daemonConfigSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
