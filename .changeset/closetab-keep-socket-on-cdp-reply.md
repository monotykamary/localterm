---
"@monotykamary/localterm-server": patch
---

`closeTab` no longer tears down the persistent CDP socket when `Target.closeTarget`
returns a CDP error reply — the normal case where `window.close()` already closed
the tab. The reconnect it forced re-fired the browser's remote-debugging consent
dialog on every automation run (close-tab-when-finished), because every fresh
WebSocket upgrade re-prompts. Only a transport drop or a call timeout now tears
the socket down; a CDP reply (e.g. "No target with given id found") is swallowed
and the one socket kept for the daemon's lifetime is preserved. `openBackgroundTab`
gets the same guard so a CDP denial no longer triggers a spurious reconnect either.
