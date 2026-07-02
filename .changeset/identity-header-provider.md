---
"@monotykamary/localterm-server": minor
---

Add an `IdentityProvider` abstraction that resolves an authenticated identity per request, plus a `header` provider that trusts a proxy-set header (`X-Forwarded-User` by default) gated by a trusted-proxy source-IP allowlist. The session registry is now partitioned by the resolved owner; with no provider configured every request is the operator tier and behavior is byte-identical to no-auth.

Multi-user access is enabled by adding an optional `identity` block to `~/.localterm/config.json`, so any identity-aware reverse proxy (Cloudflare Access, Pomerium, Caddy + oauth2-proxy, Authelia forward-auth) can front the daemon. A cross-tenant session probe surfaces as not-found; the operator tier (the CLI from loopback, the daemon's own CDP tabs) keeps full access. `passkey`/`oidc` providers slot in as new `IdentityProvider` variants.
