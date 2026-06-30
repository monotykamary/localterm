/**
 * Discover a debug-enabled Chromium browser on an explicit port.
 *
 * Two discovery paths, tried in order — mirroring browser-harness-js's
 * `resolveWsUrlFromPort`:
 *   1. `GET http://127.0.0.1:<port>/json/version` → the browser-level
 *      `webSocketDebuggerUrl`. Works for Chrome <=143 and browsers that serve
 *      the HTTP discovery endpoint.
 *   2. A `DevToolsActivePort` file whose port matches — the only reliable path
 *      for browsers that don't serve `/json/version` (Chrome 144+, Dia, Aside),
 *      since they still write the file into their user-data dir while a debug
 *      endpoint is live. Aside on 52860, for instance, is reachable this way
 *      even though its `/json/version` endpoint rejects/disappears.
 */
import { CDP_EXPLICIT_PROBE_TIMEOUT_MS, TCP_PORT_MAX } from "../constants.js";
import { detectChromiumBrowsers, type DetectedBrowser } from "./detect-chromium.js";

const EXPLICIT_PROFILE_DIR = "<explicit>";

const isUsablePort = (port: number): boolean =>
  Number.isInteger(port) && port > 0 && port <= TCP_PORT_MAX;

/**
 * Resolve the explicit-port candidate. `scanned` is the file-scan result the
 * caller already collected; it's reused as the `/json/version` fallback so we
 * don't scan twice. Returns `undefined` when the port serves no discovery
 * endpoint and no detected browser matches it.
 */
export const discoverExplicitCdpEndpoint = async (
  port: number,
  scanned: DetectedBrowser[] = [],
): Promise<DetectedBrowser | undefined> => {
  if (!isUsablePort(port)) return undefined;
  const probed = await probeJsonVersion(port);
  if (probed) return probed;
  return scanned.find((browser) => browser.port === port);
};

/** Fetch `/json/version` for `port` and synthesize a `DetectedBrowser`. */
const probeJsonVersion = async (port: number): Promise<DetectedBrowser | undefined> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CDP_EXPLICIT_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      webSocketDebuggerUrl?: unknown;
      Browser?: unknown;
    };
    if (typeof body.webSocketDebuggerUrl !== "string") return undefined;
    const wsUrl = body.webSocketDebuggerUrl;
    const wsPath = wsUrl.startsWith("ws://") ? wsUrl.slice("ws://127.0.0.1".length) : "";
    const browserLabel =
      typeof body.Browser === "string" && body.Browser.length > 0 ? body.Browser : "CDP endpoint";
    return {
      name: `${browserLabel} (127.0.0.1:${port})`,
      profileDir: EXPLICIT_PROFILE_DIR,
      port,
      wsPath: wsPath || `/devtools/browser/${port}`,
      wsUrl,
      // Sort ahead of every file-scan candidate (which are mtime-ordered) so a
      // configured port is the preferred target, falling through to the file
      // scan only when it refuses the connection.
      mtimeMs: Number.MAX_SAFE_INTEGER,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Detection used by the daemon's `CdpClient` (and the CLI probe): when an
 * explicit port is configured, resolve it first; always include the file-scan
 * results as fallback. The daemon passes this as
 * `async () => detectWithExplicitPort(cdpPort)` so a runtime config change
 * (via `PUT /api/config`) is picked up on the next `connect()` without
 * re-wiring the closure.
 */
export const detectWithExplicitPort = async (
  explicitPort: number | null,
  fileScan: () => Promise<DetectedBrowser[]> = detectChromiumBrowsers,
): Promise<DetectedBrowser[]> => {
  const scanned = await fileScan();
  if (explicitPort === null) return scanned;
  const explicit = await discoverExplicitCdpEndpoint(explicitPort, scanned);
  if (!explicit) return scanned;
  // The explicit candidate may be the same browser the file scan found (same
  // wsUrl) — e.g. when the `/json/version` fallback resolved it from the file
  // scan. Drop the duplicate so `establish()` doesn't probe it twice.
  return [explicit, ...scanned.filter((browser) => browser.wsUrl !== explicit.wsUrl)];
};
