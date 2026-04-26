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
  return LOOPBACK_HOSTS.has(hostname);
};

export const isLoopbackHost = (host: string): boolean => isLoopback(host);

export const enforceLoopback = (context: Context): Response | null => {
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
