import {
  detectChromiumBrowsers,
  detectWithExplicitPort,
  probeCdpLiveness,
  type DetectedBrowser,
} from "@monotykamary/localterm-server";

// `detectChromiumBrowsers` returns every Chromium whose user-data dir holds a
// `DevToolsActivePort` file — i.e. remote debugging was on at some point —
// most-recently-launched first, without verifying the WS endpoint accepts. A
// crashed or force-quit browser leaves that file behind, so the file scan
// alone reports a browser that isn't running (the stale Dia file bug). We
// therefore run `probeCdpLiveness` — a prompt-free TCP reachability check on
// each candidate's debug port — to filter the file-scan candidates down to
// the one that actually has a live endpoint, and report that. The probe stays
// at the TCP layer (no HTTP/WS bytes) so it never fires the remote-debugging
// consent dialog that `CdpClient.establish` pays once over WebSocket; the
// banner thus names the browser the daemon would attach to with no false
// positives from stale files and no extra prompts. When an explicit port is
// configured (`~/.localterm/config.json` `cdpPort`), it is probed first so the
// banner names the configured endpoint (e.g. Aside on 52860) rather than an
// unrelated auto-detected browser.
export type CdpAvailability = { available: true; browserName: string } | { available: false };

export const probeCdpAvailability = async (
  explicitPort: number | null = null,
  detect: () => Promise<DetectedBrowser[]> = detectChromiumBrowsers,
  probeLiveness: (candidates: DetectedBrowser[]) => Promise<DetectedBrowser | undefined> = (
    candidates,
  ) => probeCdpLiveness(candidates),
): Promise<CdpAvailability> => {
  const detected = await detectWithExplicitPort(explicitPort, detect);
  const live = await probeLiveness(detected);
  return live ? { available: true, browserName: live.name } : { available: false };
};
