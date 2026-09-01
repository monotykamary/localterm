---
"@monotykamary/localterm-server": minor
---

Prefer an unpacked Chrome extension CDP relay over remote debugging for automation tabs. `session.connect()` uses `ws://127.0.0.1:3417/extension` when the worker is attached, then falls back to `DevToolsActivePort`. Load `packages/server/extension` unpacked; `/api/health` reports `cdp.transport`.
