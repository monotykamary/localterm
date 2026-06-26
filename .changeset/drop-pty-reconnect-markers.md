---
"@monotykamary/localterm": patch
---

Drop the `[connection lost · code X]` and `[reconnected]` text the client wrote into the xterm buffer around a PTY reconnect. With daemon-side multiplexing the PTY survives transient WebSocket drops and the client silently reattaches, so on every wake/blip these markers were injected into the live shell output — corrupting the screen mid-keystroke for no informational value. The connection-lost modal and the `disconnected · code N` status badge already surface a genuine daemon-down failure (the only case where the lost-connection text carried meaning), so the in-buffer markers were redundant noise. Also drops the now-unused `format-connection-lost-marker`, `format-reconnected-marker`, and `format-cursor-reset-sequence` helpers and the dead missed-reattach branch in the session-frame handler.
