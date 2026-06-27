import { detectChromiumBrowsers, type DetectedBrowser } from "@monotykamary/localterm-server";

// `detectChromiumBrowsers` returns every Chromium with a live DevToolsActivePort
// (remote debugging on), most-recently-launched first, without verifying the
// WS endpoint accepts. The top candidate is the browser the daemon's CdpClient
// would attach to, so this is a fast, race-free prediction the install checklist
// and the start banner can show before the daemon's own connect() settles.
export type CdpAvailability = { available: true; browserName: string } | { available: false };

export const probeCdpAvailability = async (
  detect: () => Promise<DetectedBrowser[]> = detectChromiumBrowsers,
): Promise<CdpAvailability> => {
  const detected = await detect();
  const mostRecentBrowser = detected[0];
  return mostRecentBrowser
    ? { available: true, browserName: mostRecentBrowser.name }
    : { available: false };
};
