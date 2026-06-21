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

const isProxyLive = async (host: string, port: number): Promise<boolean> =>
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

export interface ResolveUrlResult {
  url: string;
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
    if (!(await isProxyLive("127.0.0.1", 443))) {
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

  const tailscaleRoute = await resolveTailscaleRoute(port);
  if (tailscaleRoute.url) {
    return { url: tailscaleRoute.url, surface: "tailnet", warnings };
  }
  const warning = tailscaleWarning(tailscaleRoute);
  if (warning) warnings.push(warning);

  const portlessRoute = await ensurePortlessRoute(port);
  if (portlessRoute.registered) {
    return { url: portlessRoute.url, surface: "portless", warnings };
  }
  if (portlessRoute.warning) warnings.push(portlessRoute.warning);

  return { url: getFriendlyUrl(port), surface: "loopback", warnings };
};

export const announceResolvedUrl = (url: string, surface: ResolveUrlResult["surface"]): void => {
  const label = surface === "tailnet" ? "tailnet" : surface === "portless" ? "local" : "loopback";
  console.log(`  url:      ${kleur.cyan(url)}  ${kleur.dim(`(${label})`)}`);
};
