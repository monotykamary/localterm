---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Add a knip-backed `lint:dead` script and sweep unused code across the terminal,
CLI, and server: drop the dead `@xterm/addon-canvas` devDependency, remove
unused declarations, un-export internal-only symbols, and dedupe
`isPortlessMissing` in the CLI.
