# Automation triggers

An automation's `trigger` is a tagged union on `kind`, **orthogonal to the `runner`** — any trigger (schedule/watch/event/webhook) fires either a shell command or a headless agent session. This reference covers all four trigger kinds in full: the schedule-shape table, the git/event taxonomy, watch debounce/filter semantics, and webhook capability-URL semantics. For the field-level summary, see [SKILL.md](../SKILL.md#automations); for the agent runner, see [agent-runner.md](agent-runner.md).

## `{kind:"schedule", schedule}` — time-based

The common case. A schedule trigger's `schedule` is a **structured schedule object** (preferred) or a bare 5-field cron string — a tagged union on `kind`:

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

Schedules are evaluated in the server's **local timezone**. The raw-cron escape hatch (`{kind:"cron", expression}`) and bare-string `schedule` support `*`, lists (`1,15`), ranges (`9-17`), steps (`*/5`, `9-17/2`), month/weekday names (`jan`, `mon-fri`), and `@hourly`/`@daily`/`@midnight`/`@weekly`/`@monthly`/`@yearly`. Vixie day semantics: if both day fields are restricted, either match fires. A bare-string schedule is recognized as a friendly preset where it maps cleanly, and kept as raw cron otherwise — losslessly either way.

## `{kind:"watch", recursive, filter?}` — filesystem changes

Fires when the automation's `cwd` changes, observed via native filesystem events (**no polling**). `recursive` (default `true`) watches the whole subtree. Optional `filter` is a glob pattern matched against the **basename** of the changed file (e.g. `"*.mov"` only fires on `.mov` files; `"*.{mov,avi}"` matches multiple extensions). When `filter` is omitted or empty, **any** change triggers the automation. Events from non-matching files are dropped before the debounce — the command never runs, and the run limit is unaffected.

After a watch-triggered run finishes, a 1-second grace period suppresses new events so the command's own side effects (e.g. deleting the source file after conversion) don't retrigger the automation. A burst of changes is debounced into a single run, and no new run starts while a previous one is still in-flight. Watch triggers have no `cron`/`nextRunAt` (both `null`).

## `{kind:"event", events: [...]}` — session events

Fires when a localterm session emits any of the named events whose cwd matches the automation's `cwd` (or is inside it). This is **session-scoped** — the automation only triggers when you are _in_ localterm and the event occurs, not from background filesystem noise. A burst of events is debounced into a single run and no new run starts while a previous one is still in-flight. Event triggers have no `cron`/`nextRunAt` (both `null`).

Git events are detected by watching the repository's `.git` directory. The operation-level events are best-effort guesses based on which ref namespace moved and which git internal files were present during the change.

### Git events

| event               | fires when                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `git-head-change`   | `.git/HEAD` changes (checkout, reset, merge into detached HEAD)                             |
| `git-branch-change` | a local branch ref is created, deleted, or moves (commit, merge, pull, reset, worktree add) |
| `git-tag-change`    | a tag is created, updated, or deleted                                                       |
| `git-remote-change` | remote-tracking refs change (fetch, pull)                                                   |
| `git-stash-change`  | the stash ref changes                                                                       |
| `git-commit`        | an existing local branch ref advances with no merge/rebase/reset state detected             |
| `git-checkout`      | HEAD changes while no branch ref moves                                                      |
| `git-reset`         | HEAD or a branch ref moves and `ORIG_HEAD` appears                                          |
| `git-merge`         | a branch ref moves while `MERGE_HEAD` was present                                           |
| `git-rebase`        | a branch ref moves while a rebase directory was present                                     |
| `git-cherry-pick`   | a branch ref moves while `CHERRY_PICK_HEAD` was present                                     |
| `git-fetch`         | only remote-tracking refs changed                                                           |

### Other events

| event          | fires when                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `git-stash`    | the stash ref changed                                                                                                    |
| `git-tag`      | a tag ref changed                                                                                                        |
| `notification` | a command emits OSC 9 (`printf '\e]9;message\a'`) in a session whose cwd matches — use your own scripts as event sources |
| `cwd`          | you `cd` into or out of the automation's directory                                                                       |
| `foreground`   | the foreground process changes in a matching session (e.g. vim starts)                                                   |
| `exit`         | a shell session in a matching directory closes                                                                           |

For "notify on push" workflows, use `git-fetch` or a custom `notification` event from your own hook — localterm cannot detect a bare `git push` from the local repository because push updates the remote, not local refs. Operation detection is best-effort; for guaranteed signals, use `{kind:"event", events:["notification"]}` and have your scripts emit `OSC 9` as the signal.

## `{kind:"webhook"}` — external HTTP

Fires when an external POST hits `/api/webhooks/<id>`. The `id` is a server-generated capability token (128-bit, base64url): the client sends `{kind:"webhook"}` with **no** id at create time, and the server returns the id in `trigger.id`. The id is preserved across PATCHes that keep the webhook kind (so editing the command/name never rotates the URL configured in CI) and is guaranteed unique across all automations. Anyone with the URL can fire the automation — Discord-style — so treat the URL as a secret.

The POST body is **ignored**: `command` and `cwd` are fixed at create time, so a webhook is a pure signal like schedule/watch/event (no payload templating, no injection surface). A burst of POSTs is debounced (trailing edge, ~500ms) into a single run, and no new run starts while a previous one is still in-flight. Webhook triggers have no `cron`/`nextRunAt` (both `null`).

Responses: `202 {"accepted":true}` on a valid+active id (always 2xx so a CI retry loop never amplifies — duplicates coalesce, in-flight POSTs are silently dropped), `404 {"error":"not_found"}` for an unknown id, `409 {"error":"automation_not_active"}` when disabled/finished. The network policy middleware gates the endpoint to the bound surface: loopback-only on a loopback bind, or any private host (incl. tailscale's `100.64.0.0/10` CGNAT range) on a non-loopback bind — so a POST from another tailnet device reaches it with no extra wiring.
