---
"@monotykamary/localterm-server": patch
---

Auto-close the desktop's share-QR modal once a mobile ingests it.

When a mobile device scans the desktop's share QR (or another tab joins via the session picker), the daemon now broadcasts a `peer-attached` control frame to the PTY's existing subscribers at attach time — before the joiner is added, so it isn't told about itself, and skipped on a fresh spawn's first attach (no peers to notify). The frame carries no payload: the recipients are, by construction, already attached to the session a peer joined.

The terminal's QR modal registers a handler while open that closes itself on `peer-attached`, but only in share mode — ingest is this tab scanning someone else's QR, so a peer joining our own session is unrelated to that and the scan stays uninterrupted. Before this the share QR stayed on screen after the handoff was already complete, so the desktop kept showing a live QR for a session it had just handed off.
