---
"@monotykamary/localterm": minor
---

Clicking an OSC 9 desktop notification now focuses the localterm tab and switches back to the PTY that emitted it. Previously the notification was shown with no click handler, so clicking did nothing. The client captures the session it's viewing when the notification fires (one WebSocket per active session means that is always the origin) and, on click, focuses the window and switches back to that PTY if the tab has since moved to another session. No server/protocol change.
