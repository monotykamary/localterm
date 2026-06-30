import { daemonConfigSchema, type DaemonConfig } from "@monotykamary/localterm-server/protocol";

const CONFIG_ENDPOINT = "/api/config";

// PUT the partial config; the daemon persists + reconnects. Returns the
// resolved (clamped) config, or null on any failure so the caller can roll
// back its optimistic state.
export const updateDaemonConfig = async (
  patch: Partial<Pick<DaemonConfig, "cdpPort">>,
): Promise<DaemonConfig | null> => {
  try {
    const response = await fetch(new URL(CONFIG_ENDPOINT, window.location.href), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return null;
    const parsed = daemonConfigSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
