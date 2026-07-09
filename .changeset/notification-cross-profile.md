---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix a notification click opening a second client on a session already viewed in another browser profile. Notifications now appear only in the profile that hosts the session (suppressed elsewhere via a per-session `hasViewers` flag the server fans out), so a click focuses that terminal and raises its window; an orphaned session with no open tab reopens in a fresh tab instead of repurposing one in use.
