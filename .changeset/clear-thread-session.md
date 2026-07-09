"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch

---

Add a "clear thread" action that restarts a thread-mode agent automation from a fresh session.

Thread agent runs resume a persistent session on each fire, and the existing "Compact now" compacts that session in place to reclaim context. There was no way to start over short of deleting the automation. The automations modal's per-automation toolbar now has a refresh button (next to Compact) for thread agent automations that deletes the persisted session file so the next fire begins a blank branch — two-click confirm, since it drops the whole thread's context. Backed by `POST /api/automations/:id/clear-thread` (409 `not_thread` for fresh/shell runs, mirroring the existing `not_compactable` guard on `…/compact`).
