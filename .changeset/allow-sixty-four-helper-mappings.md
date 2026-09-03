---
"@monotykamary/localterm": patch
---

Allow the macOS secret helper to inject up to 64 configured secrets, matching the process limit so `pi` and other shims do not exit before launch when more than 32 secrets are selected.
