---
"@monotykamary/pi-localterm": minor
---

Surface a truncated excerpt of the agent's final answer in the "pi finished" desktop notification body. The notification previously carried only identity + elapsed time; it now appends a one- to two-sentence preview of what the agent concluded — the last assistant message's text, with thinking and tool-call blocks skipped, whitespace-collapsed and capped at 160 characters with an ellipsis — so a user who stepped away can see what finished, not just that it did. Falls back to the prior `pi finished (…)` / `pi finished: <session> (…)` form when the turn produced no assistant text (e.g. it was aborted mid-tool-use).
