---
name: localterm
description: Drive the localterm daemon's HTTP API — schedule automations (cron jobs that open a terminal tab and run a command), trigger runs, inspect git diffs, and check server health. Use when the user asks to schedule, list, or manage recurring commands/cron jobs in localterm, or to script against the localterm server.
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

An automation is `{name, schedule, cwd, command, enabled}`:

- `schedule` — standard 5-field cron, evaluated in the server's local timezone.
  Supports `*`, lists (`1,15`), ranges (`9-17`), steps (`*/5`, `9-17/2`), month
  and weekday names (`jan`, `mon-fri`), and aliases `@hourly` `@daily` `@midnight`
  `@weekly` `@monthly` `@yearly`. Vixie day semantics: if both day-of-month and
  day-of-week are restricted, either matching fires the job.
- `cwd` — absolute path; must exist and be a directory on the daemon's machine
  (validated at create/update time).
- `command` — typed into an interactive shell verbatim, exactly as if the user
  typed it (shell syntax like `&&` and pipes work). Max 4096 chars.
- `enabled` — defaults to `true`. Disabled automations never fire.

When a job fires (or is run manually), the server opens
`http://localterm.localhost:<port>/?run=<id>` in the user's browser; the new tab
claims the single-use run id, spawns a shell in `cwd`, and runs `command`. The
shell stays open afterwards. For zsh/bash sessions the command's exit code is
reported back and recorded on the automation's `lastRun`.

### Endpoints

```bash
# List (includes computed nextRunAt epoch-ms, null when disabled)
curl -s "$BASE/automations"

# Create
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "nightly build",
    "schedule": "0 2 * * *",
    "cwd": "/Users/me/project",
    "command": "pnpm build && pnpm test",
    "enabled": true
  }'
# → 201 {"automation":{"id":"…","nextRunAt":1765591200000,…}}

# Update any subset of fields
curl -s -X PATCH "$BASE/automations/<id>" \
  -H 'content-type: application/json' \
  -d '{"enabled": false}'

# Delete
curl -s -X DELETE "$BASE/automations/<id>"

# Run immediately (opens the tab now; does not affect the schedule)
curl -s -X POST "$BASE/automations/<id>/run"
# → {"runId":"…"}
```

### Reading run state

Each automation carries `lastRun: {runId, at, status, exitCode}`:

| status      | meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `launched`  | tab open requested, not yet claimed by a browser tab              |
| `running`   | a tab claimed the run and the command is executing                |
| `completed` | command finished with exit code 0                                 |
| `failed`    | command finished with a non-zero `exitCode`                       |
| `missed`    | no tab claimed the run within 5 minutes (browser closed/headless) |

`completed`/`failed` are only reported for zsh and bash login shells; other shells
stay at `running` until the tab closes.

### Error responses

`400` with `{"error": "invalid_body" | "invalid_schedule" | "invalid_cwd" | "too_many_automations"}`,
or `404 {"error":"not_found"}` for unknown ids. On `invalid_cwd`, confirm the
directory exists on the daemon's machine and retry with an absolute path.

### Playbook

1. Health-check first; surface a clear "daemon not running" message if it fails.
2. Prefer one automation per task; reuse/update an existing automation with the
   same name instead of creating duplicates (list, then PATCH).
3. After creating, echo back the human-readable schedule and the `nextRunAt`
   time so the user can confirm the intent.
4. To verify an automation end-to-end, trigger `POST …/run` and poll the list
   until `lastRun.status` becomes `completed` (or `failed` — then read the tab).
5. Don't schedule destructive commands without explicit user confirmation.

## Other endpoints

```bash
curl -s "$BASE/health"                              # {"ok":true,"sessions":N}
curl -s "$BASE/git/diff-summary?cwd=/path/to/repo"  # {isRepo, files, additions, deletions, binaries}
curl -s "$BASE/git/diff?cwd=/path/to/repo"          # full per-file unified patches
```
