---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Bump dev dependencies to latest: TypeScript 5.9 → 6.0, @types/node 25 → 26, vite-plus / @voidzero-dev/vite-plus-core 0.1 → 0.2. Removed `baseUrl` from the terminal tsconfigs, which TypeScript 6 now hard-errors on (TS5101).
