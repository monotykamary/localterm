# Agent runner

An automation's `runner` is a tagged union on `kind`. This reference covers the
**agent** runner — running an agent session **headlessly in the daemon** (no
browser tab, no PTY, no WS claim). For the field-level summary and the shell
runner, see [SKILL.md](../SKILL.md#automations); for how runs fire and the run
record, see [run-states.md](run-states.md).

The agent runner is **orthogonal to the trigger**: an agent automation can fire
on any `schedule`/`watch`/`event`/`webhook` trigger, exactly like a shell
automation. Only _what runs_ differs.

## The runner shape

```jsonc
{
  "kind": "agent",
  "prompt": "Review the latest commit and post a one-paragraph summary.",
  "sessionMode": "fresh", // "fresh" | "thread"
  "model": "anthropic/claude-opus-4-5", // optional; short provider/id pattern
  "thinking": "high", // optional: off|minimal|low|medium|high|xhigh
  "harness": { "kind": "pi" }, // optional; defaults to the built-in pi harness
}
```

- `prompt` — the prompt sent to the agent. Max 4096 chars. Unlike a shell
  `command`, it's natural language, not a shell one-liner.
- `sessionMode` —
  - `fresh` (ephemeral): each fire starts a brand-new agent session (`pi
--no-session`). Nothing persists between fires. The 90% case.
  - `thread` (persistent): every fire resumes **one** session file per
    automation, kept under `~/.localterm/agent-sessions/<id>.jsonl`, so the
    agent accumulates context across fires. Use it for a recurring task that
    benefits from memory (a standing review rota, a long-lived triage agent).
- `model` — optional; passed to `pi --model` (pi harness). A short
  provider/id pattern, not a path. Omit for pi's default. The form's model
  picker is backed by `GET /api/agent-models`.
- `thinking` — optional reasoning-effort level, passed to `pi --thinking`.
  One of `off`/`minimal`/`low`/`medium`/`high`/`xhigh`.
- `harness` — selects the agent implementation (see below). Defaults to the
  built-in `pi` harness.

## The harness abstraction

The `harness` field is what makes the runner swap-ready: the rest of the
automation pipeline (trigger, limit, secrets, run history, Triage) is harness-
agnostic, so you can drive pi, claude, codex, or your own harness without
touching anything else.

### `{kind:"pi"}` — the built-in harness (default)

```jsonc
{ "kind": "pi", "extensions": true, "skills": true, "contextFiles": true }
```

Drives `pi --mode rpc` over a JSONL event stream on a child process. All three
toggles default to `true`; setting one to `false` adds the matching `--no-*`
flag (`--no-extensions`/`--no-skills`/`--no-context-files`) — the escape hatch
for runs whose provider extensions misbehave headless.

- **Status is derived from the event stream**, not the process exit code: a
  headless API failure (`stopReason:"error"`, a crash, a rejected prompt) is
  recorded as `failed` even if the process happens to exit 0. A clean
  `agent_end` with no error is `completed`.
- **The log is a structured transcript** — `user`/`assistant`/`tool` entries
  (tool results truncated; user/assistant text kept full; assistant `thinking`
  captured behind a toggle). This is what the Triage log page renders.
- **Findings** = the last assistant message text (truncated to 8000 chars),
  shown as the Triage row preview.
- **Auto-compaction is left to the harness default** (pi: on). There is no
  per-automation toggle; a manual compact is available via `POST …/compact`
  (see [Compaction](#compaction)).
- **The `pi` binary is resolved once and cached**: scanned from `PATH`, then a
  login-shell fallback (`$SHELL -l -i -c` that prints `$PATH`, sourcing the RC
  that adds pi's directory). It's spawned with that full PATH **minus the
  localterm shims dir** — the automation injects its own `requestedSecrets` as
  env directly, so the secret-injecting shim would double-inject. A successful
  resolution is cached; a `null` re-resolves (a later `pi` install is picked
  up). If `pi` isn't found, the run fails with a clear "pi not found" findings
  message.

### `{kind:"custom", command, compactCommand?}` — your own harness

```jsonc
{
  "kind": "custom",
  "command": "claude -p \"$LOCALTERM_AGENT_PROMPT\"",
  "compactCommand": "claude --compact",
}
```

Runs `command` as a shell command in the automation's `cwd` with the run
request passed as **env vars, never argv** (so a prompt full of shell
metacharacters is safe):

| env var                        | meaning                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `LOCALTERM_AGENT_PROMPT`       | the `prompt`                                               |
| `LOCALTERM_AGENT_SESSION_MODE` | `fresh` or `thread`                                        |
| `LOCALTERM_AGENT_SESSION_FILE` | absolute path to the thread session file (empty for fresh) |
| `LOCALTERM_AGENT_MODEL`        | the `model`, or empty when omitted                         |
| `LOCALTERM_AGENT_THINKING`     | the `thinking` level, or empty when omitted                |

- **stdout = findings** (truncated to 8000 chars); **stdout+stderr = the log**
  (a single string, capped at 64 KB). The run status is the **subprocess exit
  code** (0 = completed, non-zero = failed; a timeout or signal = failed with
  null exit).
- `compactCommand` (optional) compacts a thread session in place (see
  [Compaction](#compaction)). A blank/omitted `compactCommand` means
  compaction is unsupported for this harness.
- `command` and `compactCommand` run with the automation's `cwd` and its
  resolved `requestedSecrets` in env, max 4096 chars each.

## How an agent run fires

Agent runs are **headless** — there is no browser tab and no PTY:

1. The run record is created straight at status `running` (there is no
   `launched → tab-claim` step, so an agent run is never `launched`).
2. The daemon resolves the automation's `requestedSecrets` from the Keychain
   into env (fail-closed: a deleted/no-value secret is skipped, never clobbers
   an existing env var).
3. The harness runs (`pi --mode rpc` subprocess, or the custom `command`).
   Findings, the structured log, and `changedFiles` (git-status diff before
   vs after) are captured.
4. On finish the run lands at `completed` (exit 0) or `failed`, with
   `findings`/`log`/`changedFiles` filled in and `unread: true` when there are
   findings. A run with no findings stays `unread: false`.
5. A daemon restart mid-run: the startup sweep moves a still-`running` agent
   run to `missed` (it can't resume a subprocess it didn't spawn), so an
   interrupted agent run shows up as missed, not stuck.

A single agent run is capped at **10 minutes wall-clock**
(`AUTOMATION_AGENT_RUN_TIMEOUT_MS`). An agent that hangs (stuck tool, a model
that never stops) is killed and marked `failed` rather than leaking a
subprocess. For the custom harness, a timed-out run is `SIGTERM`'d then
`SIGKILL`'d after a grace period.

`closeOnFinish` is meaningless for agent runs (there is no tab to close) and
is stored as-is — leave it `false` (the default).

## Run record fields (agent runs)

Run records are shared with shell runs. `findings`/`changedFiles`/`unread` are agent-specific (`null`/`[]`/`false` for shell runs); `log` is captured for every runner (a tail-bounded ANSI-stripped PTY-output string for shell runs). The agent-run field shapes:

| field          | shape                               | meaning                                                                                                                                                                                    |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `findings`     | `string \| null`                    | truncated final assistant text (pi) or stdout (custom), max 8000. null for shell runs and when nothing was emitted.                                                                        |
| `log`          | `AgentLogEntry[] \| string \| null` | shell runs: ANSI-stripped PTY output (string). agent runs: structured transcript (pi, array) or stdout+stderr (custom, string). Discern agent transcript from string with `Array.isArray`. |
| `changedFiles` | `string[]`                          | working-tree paths whose git status changed across the run, capped at 64. Empty for shell runs and non-repos.                                                                              |
| `unread`       | `boolean`                           | `true` for agent runs with findings until opened; always `false` for shell runs.                                                                                                           |

A `log` entry is one of:

- `{type:"user", text}`
- `{type:"assistant", text, thinking?}` — `thinking` is the reasoning text, hidden by default.
- `{type:"tool", name, input?, text}` — `input` is the short header (the path/command); `text` is the truncated result.

The full per-automation `runs` history is capped at 20 entries (the log, not
the status badge, is the storage driver now).

## Thread sessions

A `thread`-mode agent automation owns one pi session file at
`~/.localterm/agent-sessions/<automation-id>.jsonl`, resumed on every fire.
Fresh runs are ephemeral (`--no-session`) and never touch this directory.

- **Deleting** a thread-mode agent automation also removes its session file, so
  an orphaned session can't be resumed by a future automation that reuses the
  id.
- **The full session transcript** (the whole resumed branch —
  user/assistant/tool/compaction, across all fires) is readable via
  `GET /api/automations/:id/session`. It's truncated at a run's `finishedAt`
  when you pass `?runId=`, so an older run shows the branch as it was _then_,
  not the latest state.
- **Open it interactively**: `GET /api/automations/:id/agent-session-url`
  returns a tab URL that opens a new terminal in the automation's `cwd` and
  types `pi --session '<file>' && exit`, so you can step into a thread agent's
  accumulated context by hand. Thread-only.

## Compaction

Thread runs resume by default; auto-compaction is on by default (the harness
default — pi compacts its own session as it grows). There is no per-automation
auto-compaction toggle anymore.

Manual compaction compacts the thread session **in place**:

```bash
# pi harness: a short-lived `pi --mode rpc` that sends `compact`.
# custom harness: runs the configured `compactCommand`.
curl -s -X POST "$BASE/automations/<id>/compact"
# → {"ok":true}  |  400 {"error":"compact_failed","message":"…"}  |  409 {"error":"not_compactable"}
```

`not_compactable` (409) is returned for fresh-mode agent runs and shell runs
(nothing to compact); `compact_failed` (400) carries the harness's error
message. Compaction resolves the automation's `requestedSecrets` into env too,
so a custom compact command sees the same keys a run does.

## Triage inbox

Agent runs produce findings to review, so the run history doubles as a Triage
inbox. Each agent run with findings is `unread` until opened.

```bash
# Mark one run read (idempotent — a missing/already-read run is a no-op success)
curl -s -X POST "$BASE/automations/<id>/runs/<runId>/read"
# → {"ok":true}  |  404 {"error":"not_found"}

# Mark every run's findings read across all automations
curl -s -X POST "$BASE/triage/mark-all-read"
# → {"ok":true}

# Clear every automation's run history (keeps the automations + run-count/lifecycle;
# drops pre-log runs that have no transcript to show)
curl -s -X POST "$BASE/triage/clear-history"
# → {"ok":true}

# Clear a single automation's run history (keeps the automation + its run-count/
# lifecycle; use /reset to also restart a finished automation)
curl -s -X POST "$BASE/automations/<id>/clear-history"
# → {"ok":true}
```

## Discovery endpoints

```bash
# Models available to the pi harness (via pi's RPC get_available_models, run
# through the localterm pi shim so every provider with a key registers). Cached
# server-side; the first call spawns pi (slow, ~1–5s), later calls reuse it.
curl -s "$BASE/agent-models"
# → {"models":[{"id":"anthropic/claude-opus-4-5","name":"…","provider":"anthropic","contextWindow":200000,"reasoning":true}, …]}

# pi skills discoverable for a project cwd (scans ~/.pi/agent/skills,
# ~/.agents/skills, and the project's .pi/skills + .agents/skills). For the
# prompt's slash-command autocomplete. Cached per cwd.
curl -s "$BASE/agent-skills?cwd=/Users/me/project"
# → {"skills":[{"name":"localterm","description":"…","disabled":false,"source":"global-pi"}, …]}

# Thread session transcript (full branch history) up to a run's point in time.
# Fresh/shell automations → {"entries":[]}.
curl -s "$BASE/automations/<id>/session?runId=<runId>"
# → {"entries":[{"type":"user","text":"…"},{"type":"assistant","text":"…","thinking":"…"},{"type":"tool","name":"read","input":"src/main.ts","text":"…"},{"type":"compaction","summary":"…","tokensBefore":12000}, …]}
```

`agent-skills` returns each skill's `source`: `global-pi` (`~/.pi/agent/skills`),
`global-agents` (`~/.agents/skills`), `project-pi` (`.pi/skills`), or
`project-agents` (`.agents/skills`). A skill with `disabled:true` has its
`disable-model-invocation` frontmatter flag set (manual-only).

## Endpoints (agent runner)

| method & path                                    | purpose                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| `POST /automations` (with `runner.kind:"agent"`) | create an agent automation                                |
| `PATCH /automations/:id`                         | update any subset (pass a `runner` to switch shell↔agent) |
| `POST /automations/:id/run`                      | fire now (does not count toward the limit)                |
| `POST /automations/:id/runs/:runId/read`         | mark one run's findings read                              |
| `POST /triage/mark-all-read`                     | mark every run read across all automations                |
| `POST /triage/clear-history`                     | clear every automation's run history                      |
| `POST /automations/:id/clear-history`            | clear one automation's run history (keeps it + run-count) |
| `GET /agent-models`                              | pi's available models (cached)                            |
| `GET /agent-skills?cwd=`                         | discoverable pi skills for a cwd (cached)                 |
| `GET /automations/:id/session?runId=`            | thread session transcript up to a run                     |
| `GET /automations/:id/agent-session-url`         | tab URL to resume a thread session interactively in pi    |
| `POST /automations/:id/compact`                  | manually compact a thread session in place                |

### Error responses

`400 {"error":"invalid_body"}` (a malformed runner/agent body), `404
{"error":"not_found"}` (unknown id/run), `409 {"error":"not_thread"}` (asked
for a session URL on a non-thread automation), `409
{"error":"not_compactable"}` (asked to compact a fresh/shell automation),
`400 {"error":"compact_failed","message":"…"}` (compaction ran but failed),
`400 {"error":"launch_failed"}` (`POST …/run` could not launch — only happens
for non-manual triggers, which `…/run` never sends, so in practice you won't
see it). `invalid_secret` (400) is returned at create/update for an unknown
`requestedSecrets` name.

## Playbook for agents

1. **Pick the runner by intent**, not by trigger. Shell for "run this command
   and watch the tab"; agent for "have an LLM do a task and report back". Any
   trigger works with either.
2. **Default to `fresh` session mode.** Use `thread` only when the agent
   should remember across fires (a standing review rota, a long-lived triage
   agent). Thread sessions accumulate context — and a session file under
   `~/.localterm/agent-sessions/` — so they're heavier.
3. **`prompt` is natural language, not a shell line.** For multi-step logic,
   point the agent at a script in `cwd` ("run `bash review.sh` and summarize
   its output") rather than embedding a 4000-char pipeline in the prompt.
4. **Grant the secrets the agent needs** via `requestedSecrets` (names from
   `localterm secret list`). They resolve into the subprocess env at spawn —
   the same least-privilege model as shell runs, but into the agent process
   instead of a PTY.
5. **Check results with Triage.** After `POST …/run`, poll `GET /automations`
   until the newest `runs[0].status` is `completed`/`failed`, then read
   `runs[0].findings` for the summary and `runs[0].log` for the transcript.
   Mark it read with `POST …/runs/:runId/read` when done.
6. **Prefer the built-in pi harness** unless you have a reason not to (you
   want claude/codex, or a self-hosted agent). It streams a real transcript and
   derives status from the event stream; a custom harness only gives you
   stdout+stderr and an exit code.
7. **Don't expect a tab.** An agent run never opens a browser tab, so
   `closeOnFinish` is irrelevant and `/run` returns immediately with a `runId`
   — poll the automation's `runs` for the outcome.
8. **Keep runs under 10 minutes.** A hung agent is killed and marked `failed`.
   For long work, split it into smaller prompts or move the heavy lifting into
   a script the agent invokes.

## Migration

The automations file migrates v3 → v4 on first boot: the bare top-level
`command` is wrapped in a shell runner (`{kind:"shell", command}`), and older
run records pick up the defaulted `findings`/`changedFiles`/`unread`/`log`
fields. Existing automations keep working unchanged; **create/update now
require a `runner` field** — a bare top-level `command` is rejected with
`invalid_body`.
