---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add a configurable no-clients grace period (Settings → Sessions → Grace period), with an "Off" option to never reap.

The 30s window a shell with no viewers stayed alive after its tab closed was a hardcoded constant (`SESSION_GRACE_MS`). It's now a daemon-global setting in `~/.localterm/config.json` (`graceSeconds`), edited through the same `GET`/`PUT /api/config` path as the CDP port and hydrated into the Settings modal on open.

- `graceSeconds` is in seconds. `null` (empty field, "Off") parks a dormant shell with no timer so it lingers until killed from the session switcher or evicted at the session cap; `0` reaps an idle shell the moment its last viewer detaches; a finite value keeps the existing behavior. A shell still running a command is never reaped regardless of the window — only a truly idle one dies within it. Bounds are 0–3600s, default 30s.
- A `PUT` re-arms every already-dormant session's grace timer via a new `SessionManager.rearmGrace()`, so a change takes effect immediately rather than only on the next detach. The manager reads the live value at each arm instead of capturing it at construction.
- The terminal Settings modal gains a "Sessions" section (after "Launch") with a numeric field and an explanatory tooltip. The commit-on-blur numeric input is extracted from the CDP port field into a shared `ConfigNumberField` so both daemon-global knobs reuse it.
