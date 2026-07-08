---
"@monotykamary/pi-localterm": minor
---

Add OSC 9 desktop notifications on agent_end. pi's only notification primitive is an in-TUI banner (`ctx.ui.notify`) that's invisible once you switch away from the pi tab; localterm already has an OSC 9 (`ESC ] 9 ; MESSAGE BEL`) → browser desktop-notification pipeline that's opt-in via "Desktop alerts" in Settings. The extension now writes an OSC 9 on `agent_end`, reusing that pipeline so a user who stepped away from the pi tab gets an OS notification when the agent finishes. Threshold-gated (turns ≥ 30s) so quick back-and-forth doesn't spam a focused user; TUI-mode-guarded so `json`/`rpc`/`-p` stdout isn't polluted with OSC bytes. Note: emitting OSC 9 also fires localterm's `notification` automation trigger, so a `notification`-event automation will fire on agent completion.
