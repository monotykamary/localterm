---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Tighten secret-bearing state-file permissions and the operator-token comparison. The auth-secret HMAC key (used to sign session cookies — if it leaks, anyone can forge a session), `config.json` (the operator token + OIDC clientSecret), and `secrets.json` are now written `0600` (owner-only) instead of default umask — a real leak risk on a shared host with a loose umask. The auth gate also now compares the operator bearer token with `crypto.timingSafeEqual` instead of plain `===`, removing a byte-by-byte timing leak against a network-reachable daemon.
