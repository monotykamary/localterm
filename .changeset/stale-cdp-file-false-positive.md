---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Verify a detected CDP candidate is actually live before the install/start banner reports it, so a stale `DevToolsActivePort` file left behind by a crashed or force-quit browser no longer produces a false-positive "debug-enabled browser detected" line. The banner now runs a prompt-free TCP reachability probe over the file-scan candidates — the same "first reachable candidate wins" approach the daemon's `CdpClient.establish` uses to hoist its persistent socket, but at the TCP layer so the remote-debugging consent dialog (Chrome 144+/Dia/Aside) is never fired and the daemon's single-prompt connect is preserved. Stale files point at ports nothing is listening on (ECONNREFUSED, near-instant) and are filtered out, so the banner names the browser the daemon would actually attach to.
