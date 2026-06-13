---
"@monotykamary/localterm-server": minor
---

Revamp automations: a full-screen modal (replacing the dropdown) with a
cross-automation **Recent runs** view and an expandable per-automation run
history; friendly **structured schedules** (daily / weekdays / weekends /
specific days / multiple times a day / every N minutes/hours) with raw cron kept
as an advanced escape hatch; run **limits** ("stop after N runs" → a terminal
`finished` state, reset to re-run) or run forever; and **downtime-aware** run
history that records scheduled times the machine missed while asleep as
`skipped` (reconstructed on the next start from a liveness heartbeat). When an
automation fires, its tab now opens in the **background** so a scheduled run no
longer steals focus from your current window: if a Chromium-based browser is
running with remote debugging enabled, the tab is created behind the active one
over the DevTools Protocol (`Target.createTarget` with `background: true`) on a
connection opened once at daemon start and reused for every run; otherwise it
falls back to the OS opener (macOS `open -g`). Set `LOCALTERM_DISABLE_CDP_TABS=1`
to force the fallback.

The automations file (`~/.localterm/automations.json`) auto-migrates v1 → v2 on
first launch — existing automations and their last run are preserved losslessly.
The HTTP API accepts the structured `schedule` object (or, for back-compat, a
bare cron string), adds an optional `limit`, exposes the run history plus a
derived `cron`/`lastRun`, and gains `POST /api/automations/:id/reset`. The
`localterm` skill and README are updated to match.
