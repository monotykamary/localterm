---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add an operator bearer token so the CLI works in passkey/oidc mode, where it can't run a WebAuthn/OIDC ceremony. `localterm config identity passkey|oidc` auto-generates a token (printed once, stored in the config, preserved across re-runs; or set explicitly with `--operator-token`), and the CLI reads it from the config and sends it as `Authorization: Bearer <token>` on `/api/*` calls. The auth gate admits it as the operator tier (full access); `header`/no-provider mode is unaffected (the gate is open, and `header` has no token).

Server: `IdentityProvider` gains `operatorToken`; the gate checks it before the session cookie.
