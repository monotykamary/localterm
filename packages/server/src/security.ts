import type { Context, MiddlewareHandler } from "hono";
import { LOOPBACK_HOSTS } from "./constants.js";

const stripPort = (hostHeader: string | undefined): string | null => {
  if (!hostHeader) return null;
  const trimmed = hostHeader.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  if (trimmed.includes(":") && !trimmed.includes(".")) {
    const colonCount = trimmed.split(":").length - 1;
    if (colonCount >= 2) return `[${trimmed}]`;
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon === -1) return trimmed;
  return trimmed.slice(0, colon);
};

const originHostname = (originHeader: string | undefined): string | null => {
  if (!originHeader) return null;
  if (originHeader === "null") return null;
  try {
    return new URL(originHeader).hostname;
  } catch {
    return null;
  }
};

const isLoopback = (hostname: string | null): boolean => {
  if (!hostname) return false;
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return false;
};

const IPV4_OCTET = /(\d+)/g;

const isPrivateIpv4 = (ip: string): boolean => {
  const octets: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = IPV4_OCTET.exec(ip)) !== null) {
    octets.push(Number.parseInt(match[1], 10));
  }
  if (octets.length !== 4) return false;
  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 127) return true;
  if (first === 169 && second === 254) return true;
  return false;
};

const isPrivateIpv6 = (hostname: string): boolean => {
  if (hostname === "::1") return true;
  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  if (hostname.startsWith("fe80")) return true;
  if (hostname.startsWith("::ffff:")) return isPrivateIpv4(hostname.slice(7));
  return false;
};

export const isLoopbackHost = (host: string): boolean => isLoopback(normalizeBareIpv6(host));

const normalizeBareIpv6 = (host: string): string => {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
};

export const isPrivateHost = (host: string): boolean => {
  const normalized = normalizeBareIpv6(host);
  if (isLoopback(normalized)) return true;
  if (normalized.endsWith(".localhost")) return true;
  const bare =
    normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
  if (bare.includes(":")) return isPrivateIpv6(bare);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return isPrivateIpv4(bare);
  return false;
};

const enforceLoopback = (context: Context): Response | null => {
  const hostHeader = context.req.header("host");
  const hostname = stripPort(hostHeader);
  if (!isLoopback(hostname)) {
    return new Response("forbidden: non-loopback host", { status: 403 });
  }
  const origin = context.req.header("origin");
  if (origin !== undefined) {
    const originHost = originHostname(origin);
    if (!isLoopback(originHost)) {
      return new Response("forbidden: cross-origin", { status: 403 });
    }
  }
  return null;
};

export const loopbackMiddleware: MiddlewareHandler = async (context, next) => {
  const blocked = enforceLoopback(context);
  if (blocked) return blocked;
  await next();
};

const publicOriginHostname = (getPublicOrigin: () => string | null): string | null => {
  const origin = getPublicOrigin();
  if (!origin) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
};

export const createNetworkPolicyMiddleware = (
  bindHost: string,
  getPublicOrigin: () => string | null = () => null,
): MiddlewareHandler => {
  const loopbackBind = isLoopback(bindHost);
  const hostAllowed = loopbackBind ? isLoopback : isPrivateHost;

  // `tailscale serve` (and any DNS-named reverse proxy on a private net) fronts
  // the loopback daemon with a hostname that isPrivateHost can't validate — it's
  // not an IP literal, and under userspace networking MagicDNS is unreachable
  // from the host so it can't be resolved either. Trust instead the surface
  // origin the CLI resolved from `tailscale status --json` Self.DNSName and set
  // via setPublicUrl; read live so a post-bind setPublicUrl applies at once.
  return async (context, next) => {
    const extraHost = publicOriginHostname(getPublicOrigin);
    const hostHeader = context.req.header("host");
    const hostname = stripPort(hostHeader);
    const hostAccepted =
      hostname !== null && hostname !== "" && (hostAllowed(hostname) || hostname === extraHost);
    if (!hostAccepted) {
      return new Response("forbidden: host not allowed", { status: 403 });
    }
    const origin = context.req.header("origin");
    if (origin !== undefined) {
      const originHost = originHostname(origin);
      const originAccepted =
        originHost !== null &&
        originHost !== "" &&
        (hostAllowed(originHost) || originHost === extraHost);
      if (!originAccepted) {
        return new Response("forbidden: cross-origin", { status: 403 });
      }
    }
    await next();
  };
};

export const isAllowedSourceIp = (remoteAddress: string, bindHost: string): boolean => {
  if (isLoopback(bindHost)) return true;
  const bare =
    remoteAddress.startsWith("[") && remoteAddress.endsWith("]")
      ? remoteAddress.slice(1, -1)
      : remoteAddress;
  const withoutZone = bare.split("%")[0];
  if (withoutZone.includes(":")) return isPrivateIpv6(withoutZone) || isLoopback(withoutZone);
  return isPrivateIpv4(withoutZone) || isLoopback(withoutZone);
};
