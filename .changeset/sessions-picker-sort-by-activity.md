---
"@monotykamary/localterm-terminal": patch
"@monotykamary/localterm-server": patch
---

Sort the session switcher by activity then recency instead of by created time, and open it on the last switched session for alt-tab-style quick switching.

The switcher now orders rows: the current tab's session pinned first, then grouped by favicon activity (running first, alive-quiet second, ready last), and within each group by most-recent output so the shells you last touched float up. The server surfaces `lastOutputAt` on each session list row to drive the recency ordering.

Opening the switcher now highlights the shell this tab last switched away from (the one viewed immediately before the current), so opening it and pressing Enter quick-switches back, alt-tab style — instead of landing on the current (pinned) session where Enter was a no-op. When that session was reaped or hasn't been recorded yet, the highlight falls back to the first switchable row so Enter still switches.
