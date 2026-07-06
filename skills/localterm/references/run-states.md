# Run state & tab mechanics

How automations fire, what shows up in run history, and the CDP/fallback browser-tab mechanics for **shell** runs. Agent runs are headless (no tab) — see [agent-runner.md](agent-runner.md) for their lifecycle. For the endpoint surface, see [SKILL.md](../SKILL.md#automations).

## How runs fire

This is the **shell** runner's path (it opens a tab and types a command). An **agent** runner skips all of it — no tab, no PTY, no WS claim: the run starts straight at `running`, the daemon spawns the harness subprocess, and it lands at `completed`/`failed` with findings + a transcript. A daemon restart mid-run sweeps a still-`running` agent run to `missed`. See [agent-runner.md](agent-runner.md).

When a shell job fires (or is run manually), the server opens the daemon's resolved URL with a `?run=<id>` query in the user's browser; the new tab claims the single-use run id, spawns a shell in `cwd`, and runs `command`. The shell stays open afterwards. For zsh/bash sessions the command's exit code is reported back and recorded in the automation's run history. The resolved URL is whichever surface `localterm install` configured (tailnet / local / loopback — see [Connect](../SKILL.md#connect)); the `127.0.0.1:$PORT/?run=<id>` raw form also works.

The run tab opens in the **background** (it does not steal focus). When a Chromium-based browser is running with remote debugging enabled, the server creates the tab behind the active one via the DevTools Protocol over a connection opened once at daemon start (so any remote-debugging prompt is cleared a single time, not per run); otherwise it falls back to the OS opener (macOS `open -g`, which keeps the browser from foregrounding). `LOCALTERM_DISABLE_CDP_TABS=1` forces the fallback. `closeOnFinish` is shell-only — honored for CDP-opened tabs (the background-tab path); on the `open -g` fallback it's a silent no-op since that tab has no closeable handle. It's meaningless for agent runs (no tab) and stored as-is.

## Reading run state

Each automation carries `runs` (newest-first, capped at 20) of `{runId, scheduledFor, startedAt, finishedAt, status, exitCode, trigger, countsTowardLimit, findings, changedFiles, unread, log}`, plus `runCount`, `lifecycle` (`active`|`finished`), and a back-compat `lastRun: {runId, at, status, exitCode}` (= the newest run). The `findings`/`log`/`changedFiles`/`unread` fields are agent-run artifacts — `null`/`[]`/`false` for shell runs:

| status      | meaning                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launched`  | tab open requested, not yet claimed by a browser tab                                                                                                                                                          |
| `running`   | a tab claimed the run and the command is executing                                                                                                                                                            |
| `completed` | command finished with exit code 0                                                                                                                                                                             |
| `failed`    | command finished with a non-zero `exitCode`                                                                                                                                                                   |
| `missed`    | no tab claimed the run within 5 minutes (browser closed/headless)                                                                                                                                             |
| `skipped`   | the daemon was **down** at that scheduled minute — reconstructed at startup from a downtime heartbeat (only the ~10 most-recent missed occurrences per automation, so real runs aren't evicted); never re-run |

`completed`/`failed` are only reported for zsh and bash login shells; other shells stay at `running` until the tab closes. The `trigger` field in each run record is `"schedule"`, `"manual"`, `"watch"`, `"event"`, or `"webhook"`. The automation-level `lifecycle:"finished"` means a `count` limit was reached — use `POST …/reset` to run it again.

**Agent runs** never enter `launched` (there's no tab to claim) — they start at `running` and end at `completed`/`failed`. An agent run still `running` after a daemon restart is swept to `missed` (the daemon can't resume a subprocess it didn't spawn). `findings` is the short preview, `log` is the full `user`/`assistant`/`tool` transcript (discerned with `Array.isArray`), `changedFiles` is the git-status diff, and `unread` is the Triage flag set when an agent run has findings. See [agent-runner.md](agent-runner.md).
