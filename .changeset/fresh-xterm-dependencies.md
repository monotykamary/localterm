---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Update dependencies to their latest releases, including xterm.js 6.1.0-beta.315 with its addons and the toolchain (vite-plus 1.3, vitest 5). Port LocalTerm's WebGL alpha-mask renderer and Kitty image patches to the new addon builds, keeping Kitty image tiles visible under text written over them now that xterm stores tile data as an extended-attribute payload. Fix HiDPI sixel images failing to scale to device pixels. Keep passkeys on EdDSA, ES256, and RS256 under SimpleWebAuthn 14 so a passkey registered on a newer Node still verifies on older supported Node versions. Chokidar moves to 5.x; 6.0 changes how native watcher errors reach LocalTerm's recovery logic and stays deferred.
