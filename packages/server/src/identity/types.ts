import type { Context } from "hono";

// The resolved identity for a single HTTP/WS-upgrade request. `user` is the
// partition key the session registry scopes by; `displayName` is the
// human-readable form for logs and (later) the session picker.
export interface Identity {
  user: string;
  displayName?: string;
}

// A strategy for turning an incoming request into an `Identity`. The `header`
// provider trusts a proxy-set header — the always-on escape hatch covering
// every external identity-aware proxy (Cloudflare Access, Pomerium,
// Caddy/OAuth2-Proxy) and self-hosted forward-auth (Authelia) with no in-app
// login flow. Future providers (`passkey`, `oidc`) add a login route group and
// issue a signed session cookie; `header` needs neither, since the proxy owns
// the login. `sourceIp` is injected by the caller (the WS upgrade reads it
// from the raw socket; HTTP routes via conninfo) so the provider never depends
// on a specific adapter's request shape.
export interface IdentityProvider {
  readonly kind: string;
  identify(context: Context, sourceIp: string | null): Identity | null;
}

// The owner key sessions are partitioned by. `null` is the operator/legacy
// tier — full access, the byte-identical-to-today behavior — and is what every
// request resolves to when no provider is configured, or a configured
// provider can't authenticate the request (a trusted-proxy connection with no
// identity header). A non-null value scopes the registry to that user.
export type SessionOwner = string | null;

// Phase 1 config: only the `header` provider. Phase 2 turns `IdentityConfig`
// into a discriminated union (`HeaderIdentityConfig | PasskeyIdentityConfig |
// OidcIdentityConfig`) as the login-flow providers are added.
export interface HeaderIdentityConfig {
  provider: "header";
  header?: string;
  trustedProxy?: string;
}

export type IdentityConfig = HeaderIdentityConfig;
