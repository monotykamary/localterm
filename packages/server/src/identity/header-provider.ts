import type { Context } from "hono";
import {
  IDENTITY_HEADER_DEFAULT,
  IDENTITY_PROXY_DEFAULT,
  IDENTITY_USER_MAX_LENGTH,
} from "../constants.js";
import type { Identity, HeaderIdentityConfig, IdentityProvider } from "./types.js";
import { createProxyAllowlist, type ProxyAllowlist } from "./proxy-allowlist.js";

// The identity provider that trusts a proxy-set header. Covers every external
// identity-aware proxy and self-hosted forward-auth with no in-app login flow:
// the proxy authenticates and forwards the user; localterm reads it.
//
// The header is only honored when the request's source IP is inside
// `trustedProxy` (default `"loopback"` — the common single-box deployment where
// the proxy runs on the same host as the daemon, so only loopback can reach it
// AND forge the header). A request from the proxy with no header resolves to
// the operator tier (no identity asserted): that's the CLI from loopback and
// the daemon's own CDP automation tabs, which keep full access — the admin
// parity a shared gateway needs. So `denyUnauthenticated` is false: a
// trusted-proxy request with no header is the operator, not a rejection.
export const createHeaderIdentityProvider = (config: HeaderIdentityConfig): IdentityProvider => {
  const header = config.header?.trim() || IDENTITY_HEADER_DEFAULT;
  const allowlist: ProxyAllowlist = createProxyAllowlist(
    config.trustedProxy?.trim() || IDENTITY_PROXY_DEFAULT,
  );
  return {
    kind: "header",
    denyUnauthenticated: false,
    identify: (context: Context, sourceIp: string | null): Identity | null => {
      const value = context.req.header(header);
      if (!value) return null;
      if (!sourceIp || !allowlist.contains(sourceIp)) return null;
      const user = value.trim().slice(0, IDENTITY_USER_MAX_LENGTH);
      return user ? { user } : null;
    },
  };
};
