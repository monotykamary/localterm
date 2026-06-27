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
 * `port === 0` (server not yet bound) returns false for the loopback branch.
 * Observation only runs after CdpClient.connect, which runs after app.listen,
 * so this branch is belt-and-braces rather than load-bearing — but it keeps an
 * early targetCreated event from picking up a stale placeholder.
 *
 * `publicUrl` is the announced REMOTE surface origin the CLI resolved
 * (best-first: tailnet `https://<node>.ts.net`, portless
 * `https://localterm.localhost`, or null for the bare loopback form) — the URL
 * mobile/remote tabs reach the daemon through, and the one `localterm start
 * --open` launches a local browser at. `localUrl` is the announced LOCAL
 * surface the CLI resolved for automation-run tabs (portless, else loopback) —
 * run tabs open in the daemon's own browser and a flapping tailnet would fail
 * the tab load there, so they use a daemon-local origin even when `publicUrl`
 * is the tailnet. A candidate matches if its origin equals either, so a tab
 * opened at the portless run-tab URL (no port) is still recognised as ours
 * alongside a tailnet `publicUrl` — without `localUrl`, ambient-token
 * injection and the CDP `closeTab`-on-exit path silently no-op on run tabs when
 * the daemon is tailnet-fronted. Origin comparison normalises default ports,
 * so `:443` and the bare `https://` form both match.
 */
export const isLocaltermTabUrl = (
  candidateUrl: string,
  port: number,
  bindHost: string,
  publicUrl?: string | null,
  localUrl?: string | null,
): boolean => {
  if (publicUrl) {
    try {
      if (new URL(candidateUrl).origin === new URL(publicUrl).origin) return true;
    } catch {
      /* malformed candidate or public URL — fall through to the local/loopback checks */
    }
  }
  if (localUrl) {
    try {
      if (new URL(candidateUrl).origin === new URL(localUrl).origin) return true;
    } catch {
      /* malformed candidate or local URL — fall through to the loopback check */
    }
  }
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
