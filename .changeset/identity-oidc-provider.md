---
"@monotykamary/localterm-server": minor
---

Add an `oidc` identity provider — bring-your-own-IdP via `oauth4webapi` (zero-dep, PKCE authorization-code flow). Any OIDC IdP (Google, GitHub, or self-hosted Authentik/Zitadel/Keycloak) authenticates; localterm keeps no passwords. A `/auth/oidc/*` login/callback/logout flow issues the same signed session cookie as `passkey`, so `identify` and the auth gate are shared. The identity is the configured userinfo claim (default `email`, falling back to `sub`); OIDC discovery is cached and retried on failure. The `redirect_uri` is the daemon's announced origin (`/auth/oidc/callback`), which must be registered with the IdP — so OIDC needs a stable announced origin (the tailnet/local-https surface), unlike `passkey` which binds to whatever origin the browser is on.

Also adds `GET /auth/provider`, an unauthenticated meta endpoint the terminal app / CLI hit before login to learn which flow to offer (`{ provider, registration }`). `header`, `passkey`, and `oidc` now form the full `IdentityConfig` discriminated union.
