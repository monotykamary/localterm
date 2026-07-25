---
"@monotykamary/localterm-server": minor
"@monotykamary/pi-localterm": minor
---

Redact secret values from captured output so a command that prints them (printenv, a config dump) never leaks into an automation result log or the agent's bash-tool context.

- Server: automations gain an opt-in `redactOutput` flag. When set, the resolved secret values are carried from launch to the run's exit and redacted from the captured, ANSI-stripped output log before it is stored or served. Resolves values from the existing launch-time backend resolution (no extra Keychain roundtrip); holds them only for the run's life.
- pi-localterm: the bash-tool operations now wrap the local shell backend and redact every stdout/stderr chunk against the secret values already in pi's own env (no Keychain access, no daemon roundtrip). A value split across onData chunk boundaries is held back by a streaming overlap tail and redacted whole once it completes; the live preview, truncation temp file, and final result all carry redacted values. The existing spawn-side env scrub stays as defense-in-depth.
- Redaction uses exact known values (user-designated secrets) gated by a length floor, with a single fixed-mask token that avoids leaking value length. No entropy gate (values are explicitly curated, not a fetched env).
