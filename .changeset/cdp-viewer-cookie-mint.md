---
"@monotykamary/localterm-server": minor
---

In auth-gated mode (passkey/oidc), mint the daemon's own CDP viewer tabs a signed session cookie so their `/ws` upgrade passes the auth gate — without it `capture-pane --png` and real-browser `mouse` degraded to `no_browser`/SGR because those tabs carry no browser session. The cookie is minted for the session's owner (the authenticated user who triggered the capture/mouse) and set via CDP `Network.setCookie` before the tab opens; an existing live viewer tab is reused as-is (it already carries the user's cookie). Headless text capture, `exec`, `wait`, send-keys, and the SGR mouse fallback were already unaffected.
