import { FRIENDLY_HOSTNAME, LOOPBACK_HOSTS } from "../constants.js";

const LOCALTERM_ORIGIN_HOSTNAMES: ReadonlySet<string> = new Set([
  ...LOOPBACK_HOSTS,
  FRIENDLY_HOSTNAME,
]);

/**
 * Whether a CDP-discovered target URL is on this server's origin. Scopes
 * ambient tab-token injection so unrelated tabs the user has open in their
 * debugged browser are never touched — only page-type targets loaded off the
 * daemon's bound port on a loopback host (or the friendly hostname that
 * resolves to loopback) get a token injected.
 *
 * `port === 0` (server not yet bound) returns false. Observation only runs
 * after CdpClient.connect, which runs after app.listen, so this branch is
 * belt-and-braces rather than load-bearing — but it keeps an early
 * targetCreated event from picking up a stale placeholder.
 */
export const isLocaltermTabUrl = (
  candidateUrl: string,
  port: number,
  bindHost: string,
): boolean => {
  if (port === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return false;
  }
  if (parsed.port !== String(port)) return false;
  // The user may open the tab via any loopback variant or the friendly
  // hostname, even when the daemon bound to one specific loopback address —
  // accept them all so the filter never drops a reachable tab.
  return LOCALTERM_ORIGIN_HOSTNAMES.has(parsed.hostname) || parsed.hostname === bindHost;
};
