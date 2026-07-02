import type { Context } from "hono";
import type { Hono } from "hono";

// The resolved identity for a single HTTP/WS-upgrade request. `user` is the
// partition key the session registry scopes by; `displayName` is the
// human-readable form for logs and (later) the session picker.
export interface Identity {
  user: string;
  displayName?: string;
}

// A strategy for turning an incoming request into an `Identity`.
//   - `header` trusts a proxy-set header — the always-on escape hatch covering
//     every external identity-aware proxy (Cloudflare Access, Pomerium,
//     Caddy/OAuth2-Proxy) and self-hosted forward-auth (Authelia), with no
//     in-app login flow. `denyUnauthenticated` is false: a trusted-proxy
//     request with no header IS the operator tier (full access).
//   - `passkey` makes localterm its own identity authority via WebAuthn: a
//     register/login flow under `/auth/passkey/*` issues a signed session
//     cookie `identify` reads. `denyUnauthenticated` is true: a request with no
//     valid session is rejected at the gate (401 / WS policy-violation), never
//     silently granted operator access — localterm IS the authority here.
//   - `oidc` (phase 3) will add a redirect flow + the same signed cookie.
export interface IdentityProvider {
  readonly kind: string;
  readonly denyUnauthenticated: boolean;
  identify(context: Context, sourceIp: string | null): Identity | null;
  // Optional route group mounted at `/auth` for providers that run a login
  // flow (`passkey`, `oidc`). `header` returns undefined — the proxy owns the
  // login. The provider closes over its own stores/secret/origin.
  routes?: () => Hono;
}

// The owner key sessions are partitioned by. `null` is the operator/legacy
// tier — full access, the byte-identical-to-today behavior — and is what every
// request resolves to when no provider is configured, or a configured provider
// can't authenticate the request (a trusted-proxy connection with no identity
// header, in `header` mode). A non-null value scopes the registry to that user.
export type SessionOwner = string | null;

export interface HeaderIdentityConfig {
  provider: "header";
  header?: string;
  trustedProxy?: string;
}

export interface PasskeyIdentityConfig {
  provider: "passkey";
  rpName?: string;
  // `"open"` (default) = anyone who can reach the daemon may register a
  // passkey; `"closed"` = registration disabled (an operator pre-provisions).
  // Open registration is gated by the same network-policy reachability check
  // every other route inherits, so it's "anyone already trusted enough to use
  // localterm", not the open internet.
  registration?: "open" | "closed";
}

export interface OidcIdentityConfig {
  provider: "oidc";
  // The IdP issuer URL (e.g. https://accounts.google.com or a self-hosted
  // Authentik/Zitadel). OIDC discovery is read from `<issuer>/.well-known/...`.
  issuer: string;
  clientId: string;
  // Omit for a public client (PKCE-only); set for a confidential client.
  clientSecret?: string;
  // The userinfo claim to use as the identity (default "email"); falls back to
  // `sub` when absent.
  claim?: string;
  // Space-separated scopes (default "openid email").
  scope?: string;
}

export type IdentityConfig = HeaderIdentityConfig | PasskeyIdentityConfig | OidcIdentityConfig;

// `GET /auth/provider` response: which login flow the terminal app / CLI should
// offer. `null` = no provider (legacy single-authority mode); `header` = an
// external proxy owns the login (no in-app flow); `passkey`/`oidc` = localterm
// runs its own login. `registration` is only meaningful for passkey.
export type IdentityProviderKind = "header" | "passkey" | "oidc";

export interface IdentityProviderInfo {
  provider: IdentityProviderKind | null;
  registration?: "open" | "closed";
}

// `GET /auth/<provider>/me` response: the currently-authenticated user, or
// null when there's no session. The auth gate uses this to decide whether to
// show the terminal or the login screen.
export interface AuthSession {
  user: string | null;
}

// Server-owned resources injected into providers that need them. The passkey
// provider uses the persisted HMAC `secret` for its session cookie, `getOrigin`
// for the WebAuthn RP ID / expected origin, and `stateDirectory` to place its
// user/credential stores next to the rest of the daemon state.
export interface IdentityProviderDeps {
  secret: string;
  getOrigin: () => string | null;
  stateDirectory: string;
}
