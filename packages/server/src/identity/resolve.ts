import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
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
