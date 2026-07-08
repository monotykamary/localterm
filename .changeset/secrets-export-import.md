---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add age-encrypted secrets export/import (CLI + UI). `localterm secret export`
and `secret import` round-trip every secret's value through a
passphrase-protected age file (interoperable with the stock `age` CLI); the
Secrets modal gets matching Export/Import buttons. Values never leave the
daemon in plaintext — only ciphertext crosses the HTTP surface, and the
passphrase transits once (same posture as `secret set`). Import reuses the
existing secret write path so shim re-bakes and the capacity gate stay
identical to a manual save.
