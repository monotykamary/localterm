---
"@monotykamary/localterm": patch
---

Harden the diff-viewer "caps the first paint of a large diff" jsdom test against CPU contention. The test stubs `requestAnimationFrame` and awaits the first paint, so it's correct in isolation (25/25), but jsdom's first paint of a 2500-line patch is CPU-bound and under turbo's parallel cross-package run it starves past vitest's 5s default — flaking sporadically. Added an inline per-test timeout (15s, matching the server's heavy-test precedent in `session.test.ts`) so contention can't blow the default.
