---
"@monotykamary/localterm-server": patch
---

Serve automation run logs on demand instead of broadcasting them with every lifecycle event. The automations list and {type:"automations"} WS broadcast now carry a log-stripped run record with a hasLog flag (the full payloads were ~1.2MB, fanned out to every tab ~3x per automation run — the freeze users saw when an automation fired); the log view fetches the stored log from the new GET /api/automations/:id/runs/:runId/log endpoint when a run is opened. Live run-tab streaming is unaffected.
