---
"@monotykamary/localterm-server": minor
---

Add public auth-response schemas + types for the client: `identityProviderInfoSchema` / `IdentityProviderInfo` (`GET /auth/provider` → which login flow to offer) and `authSessionSchema` / `AuthSession` (`GET /auth/<provider>/me` → the current user, or null).

The terminal app (`@monotykamary/localterm-terminal`, not versioned) gains an `AuthGate` that probes those endpoints before mounting the terminal: a `header`/no-provider daemon or a valid session renders the terminal immediately; a `passkey` daemon with no session shows a register / sign-in screen (via `@simplewebauthn/browser`), and an `oidc` daemon shows a redirect button to `/auth/oidc/login`. The terminal only connects to `/ws` after auth, so it never 401s on the gate. A failed probe (daemon unreachable mid-load) falls through to the terminal so the existing connection UI surfaces the real error.
