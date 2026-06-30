import {
  detectChromiumBrowsers,
  detectWithExplicitPort,
  type DetectedBrowser,
} from "@monotykamary/localterm-server";

// `detectChromiumBrowsers` returns every Chromium with a live DevToolsActivePort
// (remote debugging on), most-recently-launched first, without verifying the
// WS endpoint accepts. The top candidate is the browser the daemon's CdpClient
// would attach to, so this is a fast, race-free prediction the install checklist
// and the start banner can show before the daemon's own connect() settles.
// When an explicit port is configured (`~/.localterm/config.json` `cdpPort`),
// it is probed first so the banner names the configured endpoint (e.g. Aside on
// 52860) rather than an unrelated auto-detected browser.
export type CdpAvailability = { available: true; browserName: string } | { available: false };

export const probeCdpAvailability = async (
  explicitPort: number | null = null,
  detect: () => Promise<DetectedBrowser[]> = detectChromiumBrowsers,
): Promise<CdpAvailability> => {
  const detected = await detectWithExplicitPort(explicitPort, detect);
  const mostRecentBrowser = detected[0];
  return mostRecentBrowser
    ? { available: true, browserName: mostRecentBrowser.name }
    : { available: false };
};
