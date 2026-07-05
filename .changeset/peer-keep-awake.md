---
"@monotykamary/localterm-server": minor
"@monotykamary/localterm": minor
---

Add a peer keep-awake trigger to automatic mode: keep the machine awake while another client (e.g. a phone that ingested a share QR, or another tab via the session picker) is attached to a session. Held for the peer's lifetime and bypassing the activity gate, so an idle-but-attached phone doesn't release the machine to sleep mid-task. Toggle is in the keep-awake menu (default on); when its trigger is holding, the "Keep awake for peers" setting row tints to the caffeinate accent (label + switch), and the "Activity gate" row tints the same way when a gated program is holding. Preferences file migrates v3 → v4.
