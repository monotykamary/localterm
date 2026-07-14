---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Make pasted images ephemeral and session-scoped; use a lucide corner icon for the
keyboard swipe.

A pasted or picked image is now written to a session-scoped temp dir under the
OS temp root (not the project cwd) and reaped when the session is torn down, so a
paste lives only as long as the session that received it. The Ctrl-key swipe's
corner hint is the lucide image icon (matching the toolbar button) instead of an
emoji.