---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add `localterm config identity <provider>` to set the daemon's identity provider in `~/.localterm/config.json` — `none` (single authority), `header` (a proxy-set header), `passkey` (self-contained WebAuthn), or `oidc` (bring-your-own-IdP). Identity is built once at daemon start (unlike the live `cdpPort`/`graceSeconds` knobs), so the command writes the file directly and reminds the operator to `localterm restart`; it never talks to the running daemon. The existing config (`cdpPort`, `graceSeconds`) is preserved, and the merged file is validated against the daemon schema before writing. `--registration` is restricted to `open` | `closed`; `--issuer` / `--client-id` are required for `oidc`.

Server: export `IdentityConfig` from the protocol barrel (the command validates against it).
