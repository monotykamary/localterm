---
name: localterm
description: Drive the localterm daemon's HTTP API — schedule automations, set up event-driven triggers (git changes, shell notifications, directory changes), trigger runs, manage per-program secrets (Keychain-backed PATH shims), list/kill live sessions, inspect git diffs, and check server health. Use when the user asks to schedule, list, or manage automations, secrets, or sessions in localterm, or to script against the localterm server.
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

The user-facing browser URL (what `localterm status` prints as `url:`) is
resolved across three surfaces, best-first: **tailnet**
(`https://<node>.ts.net`, when `localterm install` ran the Tailscale step),
**local** (`https://localterm.localhost`, when the portless proxy service is
up on `:443`), or **loopback** (`http://localterm.localhost:<port>`, always
works via RFC 6761). The API calls above use the loopback raw form directly —
don't depend on which surface the browser happens to use.

## Automations

An automation is `{name, trigger, cwd, command, enabled, limit, closeOnFinish, requestedSecrets}`:

- `trigger` — what makes the automation run, a tagged union on `kind`:
  - `{kind:"schedule", schedule}` — time-based (the common case; `daily` is shown in the create examples below).
  - `{kind:"watch", recursive, filter?}` — fires when the automation's `cwd` changes (native filesystem events, no polling).
  - `{kind:"event", events: [...]}` — fires when a localterm session emits a named event matching `cwd` (session-scoped).
    See [references/triggers.md](references/triggers.md) for the full schedule-shape table (`hourly`/`weekly`/`monthly`/`cron`/…), git-event taxonomy, watch filter/debounce/grace semantics, and the cron escape-hatch details.
  - `{kind:"webhook"}` — fires when an external POST hits `/api/webhooks/<id>`. The `id` is a server-generated capability token (Discord-style: anyone with the URL can fire it); it is returned in the created automation's `trigger.id` and preserved across PATCHes that keep the webhook kind. The POST body is ignored — `command`/`cwd` are fixed at create time, so a webhook is a pure signal like schedule/watch/event.

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
- `closeOnFinish` — defaults to `false` (the tab stays open). When `true`, the run's browser tab is closed once the command finishes. Only honored for CDP-opened tabs; silent no-op on the OS-opener fallback.
- `requestedSecrets` — defaults to `[]` (the run gets no secrets). A list of secret **names** (by stable identifier, not env var) whose values are resolved from the Keychain and injected as env vars into the run's PTY at spawn. Per-automation, opt-in least-privilege: an automation gets exactly the secrets it named, nothing else. Unknown names are rejected at create/update time (catches typos); a name deleted after you selected it is skipped at run time (fail-closed). Values still never cross HTTP — resolution is Keychain → daemon → PTY env. See [references/secrets-sessions.md](references/secrets-sessions.md#automation-secret-exposure).

For run-tab mechanics (background CDP vs. opener fallback, `LOCALTERM_DISABLE_CDP_TABS`), the run-status table (`launched`/`running`/`completed`/`failed`/`missed`/`skipped`), `runs`/`runCount`/`lifecycle`/`lastRun` shape, and `trigger` field values, see [references/run-states.md](references/run-states.md).

### Endpoints

```bash
# List (each item adds computed nextRunAt epoch-ms (null when disabled/finished
# or a watch/event/webhook trigger), a derived `cron` string (null for
# watch/event/webhook), the capped `runs` history, and a back-compat `lastRun`)
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

# Create an event-triggered automation (fires on git ref changes in the directory)
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "run tests after commit",
    "trigger": { "kind": "event", "events": ["git-commit"] },
    "cwd": "/Users/me/project",
    "command": "git log --oneline -1 HEAD",
    "enabled": true,
    "limit": { "kind": "forever" }
  }'
# → 201 {"automation":{"id":"…","cron":null,"nextRunAt":null,…}}
# Runs the command whenever a localterm session in /Users/me/project detects
# that git HEAD moved (commit, push, checkout, reset). No prompt-cycle
# noise — only real ref changes. For a webhook, pipe into curl inside the
# command — $DISCORD_WEBHOOK and other env vars are available.

# Create an event automation that reacts to a custom shell notification
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "on deploy-complete signal",
    "trigger": { "kind": "event", "events": ["notification"] },
    "cwd": "/Users/me/project",
    "command": "echo \'Deploy cycle done\'",
    "enabled": true,
    "limit": { "kind": "forever" },
    "closeOnFinish": true
  }'
# → 201 {"automation":{"id":"…","trigger":{"kind":"event","events":["notification"]},…}}
# Fires when any command in this directory does: printf '\e]9;deploy-complete\a'

# Create a webhook automation (id is server-generated; the body is ignored on fire)
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "deploy on CI ping",
    "trigger": { "kind": "webhook" },
    "cwd": "/Users/me/project",
    "command": "git pull && pnpm deploy",
    "enabled": true,
    "limit": { "kind": "forever" }
  }'
# → 201 {"automation":{"id":"…","trigger":{"kind":"webhook","id":"<token>"},…}}
# Anyone with the URL can fire it: POST $BASE/webhooks/<token>  → 202 {"accepted":true}
# Duplicate/in-flight POSTs coalesce into one run; counts toward the limit.

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

### Error responses

`400` with `{"error": "invalid_body" | "invalid_schedule" | "invalid_cwd" | "too_many_automations" | "automation_finished"}`,
or `404 {"error":"not_found"}` for unknown ids. `automation_finished` is returned
when a PATCH tries to re-enable a finished automation — reset it instead. On
`invalid_cwd`, confirm the directory exists on the daemon's machine and retry with
an absolute path. The webhook endpoint (`POST /webhooks/:id`) returns `202
{"accepted":true}` on a valid+active id, `404 {"error":"not_found"}` for an
unknown id, and `409 {"error":"automation_not_active"}` when the automation is
disabled or finished.

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
7. For git-related workflows ("run tests after commit", "notify after merge"),
   use the granular git events such as `{kind:"event", events:["git-commit"]}`,
   `{kind:"event", events:["git-merge"]}`, or `{kind:"event", events:["git-fetch"]}`.
8. When the command is too complex for a readable one-liner (loops, multi-step
   pipelines with temp files, heredocs, structured output payloads, etc.), write
   a shell script in the automation's `cwd` and set `command` to `bash <name>.sh`.
   This keeps the automation JSON legible and the logic version-controlled:
   ```bash
   # Instead of inlining a 200-char pipeline, write e.g. push-watch.sh in cwd:
   curl -s -X POST "$BASE/automations" \
     -H 'content-type: application/json' \
     -d '{
       "name": "push watcher",
       "trigger": { "kind": "event", "events": ["git-fetch"] },
       "cwd": "/Users/me/open-source",
       "command": "bash push-watch.sh",
       "enabled": true
     }'
   ```

## Other endpoints

```bash
curl -s "$BASE/health"                              # {"ok":true,"sessions":N}
curl -s "$BASE/sessions"                          # live PTYs (attach by id or kill)
curl -s "$BASE/secrets"                            # per-program secrets (names + policy; never values)
curl -s "$BASE/git/diff-summary?cwd=/path/to/repo"  # {isRepo, files, additions, deletions, binaries}
curl -s "$BASE/git/diff?cwd=/path/to/repo"          # full per-file unified patches
```

For the sessions (`GET`/`DELETE /sessions/:id`) and secrets (`GET`/`PUT`/`DELETE /secrets/:name`) surfaces — including the security model (values never return over the API; use `localterm secret get` for that) and the PATH-shim injection mechanism — see [references/secrets-sessions.md](references/secrets-sessions.md). Secrets are also managed from the terminal via the `localterm secret list|get|set|delete` CLI.
