---
"@monotykamary/localterm-server": patch
"@monotykamary/localterm": patch
---

Fix macOS PTY descriptor leaks that eventually prevent new shells from opening. Ship the patched macOS backend for registry installs, clean up failed startups, and report spawn failures instead of leaving blank terminals.
