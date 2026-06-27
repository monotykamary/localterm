import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import kleur from "kleur";
import {
  PORTLESS_ALIAS_TIMEOUT_MS,
  PORTLESS_APP_NAME,
  PROXY_LIVENESS_PROBE_TIMEOUT_MS,
  getFriendlyUrl,
  getPortlessUrl,
} from "../constants.js";
import { resolveTailscaleRoute, type TailscaleRoute } from "./tailscale.js";

const execFileAsync = promisify(execFile);

export const isPortlessMissing = (error: unknown): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";

const probeLoopback = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, PROXY_LIVENESS_PROBE_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

// portless's network extension serves loopback :443 on either IPv4 or IPv6;
// observed setups answer on ::1 while a raw 127.0.0.1 connect times out, so
// probe both and accept either.
const isProxyLive = async (port: number): Promise<boolean> =>
  (await Promise.all([probeLoopback("127.0.0.1", port), probeLoopback("::1", port)])).some(Boolean);

// Whether the portless proxy is serving the loopback HTTPS surface (:443).
// `portless service install` is only boot registration and fails spuriously on
// existing installs, so callers (e.g. `localterm install`) treat this as the
// source of truth for "is the proxy actually up" rather than the install's
// exit code.
export const isPortlessProxyLive = async (): Promise<boolean> => isProxyLive(443);

export interface ResolveUrlResult {
  url: string;
  // Daemon-local origin automation-run tabs open at — portless
  // `https://localterm.localhost` when the proxy is live, else the loopback
  // `http://<friendly>:<port>`. Independent of `url` (the remote surface for
  // mobile/browser-open) so a tailnet-fronted daemon still serves mobile on
  // the tailnet URL while run tabs — which open in the daemon's own browser —
  // never ride a flapping `tailscale serve` that would fail the tab load and
  // the automation.
  localUrl: string;
  surface: "tailnet" | "portless" | "loopback";
  warnings: string[];
}

const tailscaleWarning = (route: TailscaleRoute): string | null => {
  switch (route.reason) {
    case "binary-missing":
      return `tailscale not installed — install from ${route.hint ?? "https://tailscale.com/download"}`;
    case "https-disabled":
      return `tailscale HTTPS certs disabled — enable at ${route.hint ?? "https://login.tailscale.com/admin/settings/features"}`;
    case "offline":
      return "tailscale offline — run `tailscale up` or `pnpm cli install`";
    case "serve-mismatch":
      return null;
    case undefined:
      return null;
  }
  return null;
};

const ensurePortlessRoute = async (
  port: number,
): Promise<{
  url: string;
  registered: boolean;
  warning?: string;
}> => {
  try {
    await execFileAsync("portless", ["alias", PORTLESS_APP_NAME, String(port), "--force"], {
      timeout: PORTLESS_ALIAS_TIMEOUT_MS,
    });
    if (!(await isProxyLive(443))) {
      return {
        url: getFriendlyUrl(port),
        registered: false,
        warning: "portless proxy not running on :443 — run `pnpm cli install` for named URLs",
      };
    }
    return { url: getPortlessUrl(), registered: true };
  } catch (error) {
    if (isPortlessMissing(error)) {
      return {
        url: getFriendlyUrl(port),
        registered: false,
        warning: "portless not installed — run `pnpm cli install` for named URLs",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      url: getFriendlyUrl(port),
      registered: false,
      warning: `portless route not registered (${message}) — run \`pnpm cli install\``,
    };
  }
};

export const resolveDaemonUrl = async (port: number): Promise<ResolveUrlResult> => {
  const warnings: string[] = [];

  // Resolve both surfaces in parallel — they probe independent binaries
  // (`tailscale serve status` / `portless alias`), so concurrency doesn't race
  // shared state and keeps startup at max() rather than sum() of the probes.
  // `ensurePortlessRoute` always runs (even when tailnet fronts the daemon) so
  // the portless alias is re-registered for the current bound port — without
  // it the run tab's `https://localterm.localhost` wouldn't reach the daemon.
  const [tailscaleRoute, portlessRoute] = await Promise.all([
    resolveTailscaleRoute(port),
    ensurePortlessRoute(port),
  ]);

  const tailscaleWarningMessage = tailscaleWarning(tailscaleRoute);
  if (tailscaleWarningMessage) warnings.push(tailscaleWarningMessage);

  const hasPortless = Boolean(portlessRoute.registered);

  // Run tabs open in the daemon's own browser, so they prefer a daemon-local
  // surface that never rides the tailnet: portless (HTTPS, local :443 alias)
  // when the proxy is live, else the always-local loopback form.
  const localUrl = hasPortless ? portlessRoute.url : getFriendlyUrl(port);

  // The remote surface mobile/remote tabs and `--open` use: best-first tailnet
  // → portless → loopback, unchanged from the single-surface resolution.
  const url = tailscaleRoute.url ?? (hasPortless ? portlessRoute.url : getFriendlyUrl(port));
  const surface: ResolveUrlResult["surface"] = tailscaleRoute.url
    ? "tailnet"
    : hasPortless
      ? "portless"
      : "loopback";

  // Only surface the portless warning when portless is the intended REMOTE
  // surface and it's unavailable — when tailnet fronts the daemon the run tab's
  // loopback fallback is fine and the portless warning is just noise.
  if (!tailscaleRoute.url && !hasPortless && portlessRoute.warning) {
    warnings.push(portlessRoute.warning);
  }

  return { url, localUrl, surface, warnings };
};

export const announceResolvedUrl = (url: string, surface: ResolveUrlResult["surface"]): void => {
  const label = surface === "tailnet" ? "tailnet" : surface === "portless" ? "local" : "loopback";
  console.log(`  url:      ${kleur.cyan(url)}  ${kleur.dim(`(${label})`)}`);
};
