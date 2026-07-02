import type { Context } from "hono";
import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { HTTP_STATUS_UNAUTHORIZED } from "../constants.js";
import type { Identity, IdentityProvider, SessionOwner } from "./types.js";

// Best-effort source-IP read for an HTTP (non-WS) request. @hono/node-server's
// conninfo reads the underlying socket's remoteAddress. Returns null when the
// adapter doesn't expose it (or the helper throws — never 500 a request over
// an identity read) so the caller falls back to "untrusted source" and ignores
// any identity header.
export const getRequestSourceIp = (context: Context): string | null => {
  try {
    const address = getConnInfo(context).remote.address;
    return typeof address === "string" ? address : null;
  } catch {
    return null;
  }
};

export interface IdentityResolver {
  resolve: (context: Context, sourceIp?: string | null) => Identity | null;
}

// Build the per-request identity resolver. With no provider configured it
// resolves to `null` for every request — the operator/legacy tier — so every
// request is the single authority and the registry stays unscoped,
// byte-identical to the no-auth behavior. Otherwise it delegates to the
// provider, injecting the caller-resolved source IP: the WS upgrade reads it
// from the raw socket (more authoritative than conninfo at upgrade time), HTTP
// routes via conninfo.
export const createIdentityResolver = (provider: IdentityProvider | null): IdentityResolver => ({
  resolve: (context: Context, sourceIp: string | null = null): Identity | null =>
    provider ? provider.identify(context, sourceIp) : null,
});

export const toSessionOwner = (identity: Identity | null): SessionOwner =>
  identity ? identity.user : null;

// The auth gate for providers that own their own login (passkey/oidc): reject a
// request with no valid session at the door (401) so it never reaches the
// session registry — unlike `header`, whose no-header case is the operator
// tier (denyUnauthenticated: false), there's no external proxy to vouch for an
// unauthenticated caller here, so silence can't mean admin. Exempts
// `/api/health` (readiness) and everything outside `/api` and `/ws` (the static
// terminal app + the `/auth` login flow must load before there's a session). A
// request carrying the daemon's operator bearer token (the CLI) is admitted as
// the operator tier — full access, no session — since the CLI can't run a
// WebAuthn/OIDC ceremony.
export const createAuthGateMiddleware =
  (
    provider: IdentityProvider | null,
    resolveIdentity: (context: Context, sourceIp?: string | null) => Identity | null,
  ): MiddlewareHandler =>
  async (context, next) => {
    if (!provider?.denyUnauthenticated) return await next();
    const requestPath = context.req.path;
    const isProtected =
      (requestPath === "/ws" || requestPath.startsWith("/api/")) && requestPath !== "/api/health";
    if (!isProtected) return await next();
    if (
      provider.operatorToken &&
      context.req.header("authorization") === `Bearer ${provider.operatorToken}`
    ) {
      return await next();
    }
    const identity = resolveIdentity(context, getRequestSourceIp(context));
    if (!identity) return context.json({ error: "unauthorized" }, HTTP_STATUS_UNAUTHORIZED);
    await next();
  };
