---
"@monotykamary/localterm-server": minor
---

Add a `passkey` identity provider — localterm as its own identity authority via WebAuthn, with no external IdP or proxy. A `/auth/passkey/*` register/login/logout flow (`@simplewebauthn/server`) issues a signed HMAC session cookie that `identify` reads, so every tab after the first login re-authenticates silently. An unauthenticated request is rejected at a new auth gate (401 / WS policy-violation) rather than falling through to the operator tier — unlike `header`, there's no proxy to vouch for one. Users and credential key material persist in `~/.localterm/{users,credentials}.json`; the HMAC secret in `~/.localterm/auth-secret`.

Enabled via the config-file `identity` block (`{ "provider": "passkey", "registration": "open" | "closed" }`). `header` and `passkey` are now a discriminated union; `oidc` (bring-your-own-IdP) is the next variant. `IdentityProvider` gains `denyUnauthenticated` and an optional `routes()` for login-flow providers. In passkey mode the CDP-driven `capture-pane --png` degrades to `no_browser` (the daemon's viewer tab has no session cookie) — headless text capture, `exec`, `wait`, send-keys, and the SGR mouse fallback all still work.
