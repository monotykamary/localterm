import {
  cdpConnectResultSchema,
  type CdpConnectResult,
} from "@monotykamary/localterm-server/protocol";

const CDP_CONNECT_ENDPOINT = "/api/cdp/connect";

// Explicit "Connect now" for the Settings → Automation browser → Connect
// button. Awaits the daemon's fresh connect and returns the outcome (connected
// browser, or the error that explains a failure), so the UI can show something
// actionable instead of polling /api/health and guessing.
export const connectCdp = async (): Promise<CdpConnectResult | null> => {
  try {
    const response = await fetch(new URL(CDP_CONNECT_ENDPOINT, window.location.href), {
      method: "POST",
    });
    if (!response.ok) return null;
    const parsed = cdpConnectResultSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
