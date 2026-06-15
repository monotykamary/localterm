---
name: localterm
description: Drive the localterm daemon's HTTP API — schedule automations, set up event-driven triggers (git changes, shell notifications, directory changes), trigger runs, inspect git diffs, and check server health. Use when the user asks to schedule, list, or manage automations in localterm, or to script against the localterm server.
---

# localterm API

localterm (https://github.com/monotykamary/localterm) is a local daemon that serves
terminals as browser tabs. It exposes an unauthenticated, loopback-only HTTP API you
can call with `curl`. The flagship resource is **automations**: server-managed cron
jobs that, when due, open a new browser tab in a chosen directory and type the
command into a fresh shell. The tab stays open after the command finishes so the
user sees that it ran and whether it succeeded — never append `exit` to a command.

## Connect

The daemon writes its state to `~/.localterm/`:

```bash
PORT=$(cat ~/.localterm/server.port 2>/dev/null || echo 3417)
BASE="http://127.0.0.1:$PORT/api"
curl -s "$BASE/health"   # → {"ok":true,"sessions":N}
```

If the health check fails, the daemon isn't running. Ask the user to start it (or
run it yourself if authorized):

```bash
npx @monotykamary/localterm@latest start
```

Requests must come from the same machine; `Host` must be loopback (using
`127.0.0.1` with curl satisfies this).

## Automations

An automation is `{name, trigger, cwd, command, enabled, limit, closeOnFinish}`:

- `trigger` — what makes the automation run, a tagged union on `kind`:
  - `{kind:"schedule", schedule}` — time-based (the common case).
  - `{kind:"watch", recursive, filter?}` — fires when the automation's `cwd`
    changes, observed via native filesystem events (**no polling**). `recursive`
    (default `true`) watches the whole subtree. Optional `filter` is a glob
    pattern matched against the **basename** of the changed file (e.g.
    `"*.mov"` only fires on `.mov` files; `"*.{mov,avi}"` matches multiple
    extensions). When `filter` is omitted or empty, **any** change triggers the
    automation. Events from non-matching files are dropped before the debounce
    — the command never runs, and the run limit is unaffected. After a
    watch-triggered run finishes, a 1-second grace period suppresses new
    events so the command's own side effects (e.g. deleting the source file
    after conversion) don't retrigger the automation. A burst of changes is
    debounced into a single run, and no new run starts while a previous one is
    still in-flight. Watch triggers have no `cron`/`nextRunAt` (both `null`).
  - `{kind:"event", event}` — fires when a localterm session emits a named
    event whose cwd matches the automation's `cwd` (or is inside it). This is
    **session-scoped** — the automation only triggers when you are _in_
    localterm and the event occurs, not from background filesystem noise. A
    burst of events is debounced into a single run and no new run starts while
    a previous one is still in-flight. Event triggers have no
    `cron`/`nextRunAt` (both `null`). The available events:

    | event          | fires when                                                             |
    | -------------- | ---------------------------------------------------------------------- |
    | `git-dirty`    | the shell's prompt hook detects the working tree may have changed      |
    |                | (commits, checkouts, stashes, edits, `git add`, etc.)                  |
    | `notification` | a command emits OSC 9 (`printf '\e]9;message\a'`)                      |
    |                | in a session whose cwd matches — use your own scripts as event sources |
    | `cwd`          | you `cd` into or out of the automation's directory                     |
    | `foreground`   | the foreground process changes in a matching session (e.g. vim starts) |
    | `exit`         | a shell session in a matching directory closes                         |

    The most common use case is `git-dirty`: create one event automation per
    repo directory and it fires every time you do something git-related while
    working in that repo inside localterm — no polling, no false positives
    from background processes.

  A schedule trigger's `schedule` is a **structured schedule object** (preferred)
  or a bare 5-field cron string — a tagged union on `kind`:

  | `kind`           | shape                                                                  | example meaning                 |
  | ---------------- | ---------------------------------------------------------------------- | ------------------------------- |
  | `hourly`         | `{kind:"hourly", minute}`                                              | every hour at `:minute`         |
  | `daily`          | `{kind:"daily", hour, minute}`                                         | every day at 9am                |
  | `timesOfDay`     | `{kind:"timesOfDay", times:[{hour,minute},…]}`                         | several fixed times a day (≤12) |
  | `weekdaysPreset` | `{kind:"weekdaysPreset", preset:"weekdays"\|"weekends", hour, minute}` | Mon–Fri / Sat–Sun               |
  | `weekly`         | `{kind:"weekly", daysOfWeek:[0–6], hour, minute}`                      | 0=Sun … 6=Sat                   |
  | `monthly`        | `{kind:"monthly", daysOfMonth:[1–31], hour, minute}`                   | on the 1st and 15th             |
  | `everyNMinutes`  | `{kind:"everyNMinutes", step}`                                         | every N minutes                 |
  | `everyNHours`    | `{kind:"everyNHours", step, minute}`                                   | every N hours on the clock      |
  | `cron`           | `{kind:"cron", expression}`                                            | the advanced escape hatch       |

  Schedules are evaluated in the server's **local timezone**. The raw-cron escape
  hatch (`{kind:"cron", expression}`) and bare-string `schedule` support `*`,
  lists (`1,15`), ranges (`9-17`), steps (`*/5`, `9-17/2`), month/weekday names
  (`jan`, `mon-fri`), and `@hourly`/`@daily`/`@midnight`/`@weekly`/`@monthly`/
  `@yearly`. Vixie day semantics: if both day fields are restricted, either match
  fires. A bare-string schedule is recognized as a friendly preset where it maps
  cleanly, and kept as raw cron otherwise — losslessly either way.

- `cwd` — absolute path; must exist and be a directory on the daemon's machine
  (validated at create/update time).
- `command` — typed into an interactive shell verbatim (shell syntax like `&&`
  and pipes work). Max 4096 chars.
- `enabled` — defaults to `true`. Disabled automations never fire.
- `limit` — `{kind:"forever"}` (default) or `{kind:"count", max:N}` = "stop after
  N runs". When the limit is reached the automation **finishes** (a terminal
  `lifecycle:"finished"` state) and stops firing but stays listed with its
  history. Scheduled, watch, and event runs count toward the limit; manual `/run` never
  does.
- `closeOnFinish` — defaults to `false` (the tab stays open). When `true`, the
  run's browser tab is closed once the command finishes. Only honored for tabs
  opened via CDP (the background-tab path); on the `open -g` fallback it's a
  silent no-op since that tab has no closeable handle.

When a job fires (or is run manually), the server opens
`http://localterm.localhost:<port>/?run=<id>` in the user's browser; the new tab
claims the single-use run id, spawns a shell in `cwd`, and runs `command`. The
shell stays open afterwards. For zsh/bash sessions the command's exit code is
reported back and recorded in the automation's run history.

The run tab opens in the **background** (it does not steal focus). When a
Chromium-based browser is running with remote debugging enabled, the server
creates the tab behind the active one via the DevTools Protocol over a
connection opened once at daemon start (so any remote-debugging prompt is
cleared a single time, not per run); otherwise it falls back to the OS opener
(macOS `open -g`, which keeps the browser from foregrounding).
`LOCALTERM_DISABLE_CDP_TABS=1` forces the fallback.

### Endpoints

```bash
# List (each item adds computed nextRunAt epoch-ms (null when disabled/finished
# or a watch/event trigger), a derived `cron` string (null for watch/event), the capped
# `runs` history, and a back-compat `lastRun`)
curl -s "$BASE/automations"

# Create
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "nightly build",
    "trigger": { "kind": "schedule", "schedule": { "kind": "daily", "hour": 2, "minute": 0 } },
    "cwd": "/Users/me/project",
    "command": "pnpm build && pnpm test",
    "enabled": true,
    "limit": { "kind": "forever" }
  }'
# → 201 {"automation":{"id":"…","cron":"0 2 * * *","nextRunAt":1765591200000,…}}

# Create a folder-watch automation (runs when cwd changes; no cron/nextRunAt)
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "rebuild on change",
    "trigger": { "kind": "watch", "recursive": true },
    "cwd": "/Users/me/project",
    "command": "pnpm build",
    "limit": { "kind": "count", "max": 50 }
  }'
# → 201 {"automation":{"id":"…","cron":null,"nextRunAt":null,…}}

# Create a filtered folder-watch (only triggers on .mov files)
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "autoconvert mov→mp4",
    "trigger": { "kind": "watch", "recursive": false, "filter": "*.mov" },
    "cwd": "/Users/me/Downloads",
    "command": "find /Users/me/Downloads -maxdepth 1 -iname *.mov -type f | while IFS= read -r f; do mp4=\"${f%.*}.mp4\"; if [ ! -f \"$mp4\" ]; then ffmpeg -y -i \"$f\" -c:v libx264 -crf 28 -preset medium -c:a aac -b:a 128k \"$mp4\" && rm \"$f\"; else rm \"$f\"; fi; done",
    "enabled": true,
    "limit": { "kind": "forever" },
    "closeOnFinish": true
  }'
# → 201 {"automation":{"id":"…","trigger":{"kind":"watch","recursive":false,"filter":"*.mov"},…}}

# Create an event-triggered automation (fires on git changes in the directory)
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "notify on push",
    "trigger": { "kind": "event", "event": "git-dirty" },
    "cwd": "/Users/me/project",
    "command": "git log --oneline -1 HEAD",
    "enabled": true,
    "limit": { "kind": "forever" }
  }'
# → 201 {"automation":{"id":"…","cron":null,"nextRunAt":null,…}}
# Runs the command whenever a localterm session in /Users/me/project detects
# git state changed (commit, checkout, push, etc.). For a webhook, pipe into
# curl inside the command — $DISCORD_WEBHOOK and other env vars are available.

# Create an event automation that reacts to a custom shell notification
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "on deploy-complete signal",
    "trigger": { "kind": "event", "event": "notification" },
    "cwd": "/Users/me/project",
    "command": "echo \'Deploy cycle done\'",
    "enabled": true,
    "limit": { "kind": "forever" },
    "closeOnFinish": true
  }'
# → 201 {"automation":{"id":"…","trigger":{"kind":"event","event":"notification"},…}}
# Fires when any command in this directory does: printf '\e]9;deploy-complete\a'

# Update any subset of fields (pass a `trigger` to change the schedule/watch/event)
curl -s -X PATCH "$BASE/automations/<id>" \
  -H 'content-type: application/json' \
  -d '{"limit": {"kind": "count", "max": 20}}'

# Delete
curl -s -X DELETE "$BASE/automations/<id>"

# Run immediately (opens the tab now; does not affect the schedule or the limit)
curl -s -X POST "$BASE/automations/<id>/run"
# → {"runId":"…"}

# Reset a finished automation (zeroes runCount, re-activates, re-enables).
# Optional body {"clearHistory": true} also empties the run history.
curl -s -X POST "$BASE/automations/<id>/reset"
```

### Reading run state

Each automation carries `runs` (newest-first, capped at 50) of
`{runId, scheduledFor, startedAt, finishedAt, status, exitCode, trigger, countsTowardLimit}`,
plus `runCount`, `lifecycle` (`active`|`finished`), and a back-compat
`lastRun: {runId, at, status, exitCode}` (= the newest run):

| status      | meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `launched`  | tab open requested, not yet claimed by a browser tab                   |
| `running`   | a tab claimed the run and the command is executing                     |
| `completed` | command finished with exit code 0                                      |
| `failed`    | command finished with a non-zero `exitCode`                            |
| `missed`    | no tab claimed the run within 5 minutes (browser closed/headless)      |
| `skipped`   | the daemon was **down** at that scheduled minute — reconstructed at    |
|             | startup from a downtime heartbeat (only the ~10 most-recent missed     |
|             | occurrences per automation, so real runs aren't evicted); never re-run |

`completed`/`failed` are only reported for zsh and bash login shells; other shells
stay at `running` until the tab closes. The `trigger` field in each run record is
`"schedule"`, `"manual"`, `"watch"`, or `"event"`. The automation-level
`lifecycle:"finished"` means a `count` limit was reached — use `POST …/reset` to
run it again.

### Error responses

`400` with `{"error": "invalid_body" | "invalid_schedule" | "invalid_cwd" | "too_many_automations" | "automation_finished"}`,
or `404 {"error":"not_found"}` for unknown ids. `automation_finished` is returned
when a PATCH tries to re-enable a finished automation — reset it instead. On
`invalid_cwd`, confirm the directory exists on the daemon's machine and retry with
an absolute path.

### Playbook

1. Health-check first; surface a clear "daemon not running" message if it fails.
2. Prefer one automation per task; reuse/update an existing automation with the
   same name instead of creating duplicates (list, then PATCH).
3. Prefer a structured `schedule` (e.g. `{"kind":"daily","hour":9,"minute":0}`)
   over raw cron so the user sees a friendly label; fall back to
   `{"kind":"cron","expression":"…"}` only for schedules the presets can't express.
4. After creating, echo back the human-readable schedule and the `nextRunAt`
   time so the user can confirm the intent.
5. To verify an automation end-to-end, trigger `POST …/run` (this does not count
   toward a `limit`) and poll the list until the newest `runs[0].status` /
   `lastRun.status` becomes `completed` (or `failed` — then read the tab).
6. Don't schedule destructive commands without explicit user confirmation.
7. For git-related workflows ("notify on push", "run tests after commit"), prefer
   `{kind:"event", event:"git-dirty"}` over a folder watch — it's session-scoped
   (no false positives from background processes), fires only when you're
   working in localterm, and carries git semantics instead of raw filesystem
   noise. For custom event-driven workflows, use `{kind:"event",
event:"notification"}` and have your scripts emit `OSC 9` as the signal.

## Other endpoints

```bash
curl -s "$BASE/health"                              # {"ok":true,"sessions":N}
curl -s "$BASE/git/diff-summary?cwd=/path/to/repo"  # {isRepo, files, additions, deletions, binaries}
curl -s "$BASE/git/diff?cwd=/path/to/repo"          # full per-file unified patches
```
