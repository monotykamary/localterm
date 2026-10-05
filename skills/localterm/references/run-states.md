# Run state & tab mechanics

## Admission and durable dispatch

Every trigger and Run now passes through the same dispatcher. An accepted request is persisted as `queued` before execution. The record snapshots its command/prompt, directory, requested secret names, and execution options (never secret values). The snapshot is internal; list responses omit it and the full log.

`concurrencyPolicy` is `skip` (default), `queue-latest`, or `allow` (bounded to eight active runs per automation). Persistent agent threads never overlap. Folder/session-event triggers also retain their feedback-loop guards; webhooks use the shared policy after debounce.

A queued run starts when capacity becomes available. A newer request under `queue-latest` supersedes the older queued request. Pausing cancels automatic queued work; remaining run-limit budget is checked at dispatch. Manual runs can run while paused/finished but still obey concurrency controls.

On restart, only queued work is resumed. Already launched/running work becomes `interrupted`: the daemon cannot prove whether external side effects happened, so it does not replay it. Scheduled occurrence watermarks survive history cleanup and prevent duplicate admission. Controlled shutdown aborts and awaits agent subprocess teardown before returning.

## Run states

| Status        | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `queued`      | Accepted durably, waiting to start; can be cancelled.                         |
| `launched`    | Shell tab requested, awaiting its single-use WebSocket claim.                 |
| `running`     | Shell command or headless agent executing.                                    |
| `completed`   | Successful completion.                                                        |
| `failed`      | Command/harness or launch failed.                                             |
| `missed`      | No shell tab claimed the run within five minutes.                             |
| `skipped`     | Not executed: downtime policy, overlap, superseded pending work, or capacity. |
| `cancelled`   | Queued work cancelled by the user, pause, or exhausted budget.                |
| `interrupted` | Execution had begun before a daemon restart; not automatically replayed.      |

Optional `reason` distinguishes `overlap`, `superseded`, `downtime`, `disabled`, `limit`, `restart`, `capacity`, `launch-failed`, and `cancelled`. `scheduledFor` is the intended instant; `startedAt` is null before launch. `countsTowardLimit` is true only for an automatic launch attempt, never for manual or unstarted work.

`runs` is newest-first with a twenty-record history cap that never evicts active work. Clearing history or resetting a run limit preserves queued/launched/running records. The legacy `lastRun` projects the newest record and is not an active-run lock. Scan all runs to determine whether work is in flight.

`missedRunPolicy` is `skip` or `run-latest`. Downtime and live sleep gaps use the same policy; run-latest admits at most one catch-up occurrence. Recovery is bounded to the latest ten occurrences in a fourteen-day lookback, and never reconstructs runs before creation. A current occurrence still fires normally.

## Shell and agent execution

A shell launch opens the daemon's local surface with `?run=<id>` in a background tab. Its single-use claim creates a fresh shell in `cwd`, runs the command, and reports completion. CDP opens the tab without stealing focus; the fallback is the OS opener (macOS `open -g`). `LOCALTERM_DISABLE_CDP_TABS=1` forces the fallback. `closeOnFinish` needs CDP; otherwise the tab stays open. Browser availability is reflected in health and the editor.

Agent runs are headless: after `queued` they enter `running` without a tab, PTY, or WebSocket claim. Findings, changed files, unread state, and transcript are retained. See [agent-runner.md](agent-runner.md). A missing browser does not prevent an agent run.

## API

`POST /api/automations/:id/run` returns `{runId,status}`. Check status: a successful HTTP response can represent queued or skipped work, not an immediate launch.

`POST /api/automations/:id/runs/:runId/cancel` cancels only a queued run; returns `409 run_not_queued` otherwise. Deletion, thread compaction, and clearing a thread return `409 automation_busy` while active or queued work remains. Cancellation does not kill an already executing command.

The list and broadcasts expose `hasLog`; load a transcript with `GET /api/automations/:id/runs/:runId/log`. Agent findings and the Triage inbox remain independent of the Upcoming agenda.
