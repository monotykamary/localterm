---
"@monotykamary/localterm": minor
---
Group the triage log into Gmail-style conversation threads.

Same-automation runs now collapse into a single expandable thread once an automation has two or more runs in the visible set (single-run automations stay as plain inline rows), so a high-frequency watcher — e.g. a recursive push watcher over an open-source tree — no longer floods the inbox with identically-named rows. Threads nest under Today / Yesterday / This week / Earlier date bands (a thread sits in the band of its newest run), are sorted newest-first, and carry an unread dot plus an "N runs · M unread" meta; threads with unread runs expand by default so the unread filter still surfaces them. The date-banding and grouping logic are pure utils with deterministic unit tests.
