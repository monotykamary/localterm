# Sessions & exec (PTY control)

The tmux-parity surface: drive PTYs programmatically over the loopback HTTP API
and the `localterm session` CLI — list, create, send-keys, capture-pane, resize,
rename, kill — plus **exec**, the synchronous command+output+exit-code primitive
that's the LLM-ergonomic upgrade over tmux's fire-and-forget `send-keys`.

This reference covers the REST + CLI surface introduced for headless/agent
control. The browser-tab model (attach, the grace window, the session picker)
and the secrets surface are in [secrets-sessions.md](secrets-sessions.md).

## Connect

```bash
PORT=$(cat ~/.localterm/server.port 2>/dev/null || echo 3417)
BASE="http://127.0.0.1:$PORT/api"
curl -s "$BASE/health"   # → {"ok":true,"sessions":N}
```

Same loopback-only, same-machine contract as the rest of the API.

## The mental model

- A **session** is one live PTY (a shell). Browser tabs are just views onto a
  session (`?sid=<id>` attaches). The REST/CLI surface lets you create and drive
  sessions _without_ a browser tab.
- Sessions created over REST (`POST /api/sessions`, `localterm session new`)
  are **pinned by default**: exempt from the ~30s idle reap that reaps browser
  tabs' dormant shells, so an agent that spawns now and `send-keys` minutes
  later doesn't lose its shell. A pinned session lives until you `kill` it or its
  shell exits. `--no-pin` (REST `pinned:false`) enters the grace window like a
  browser tab nobody opened.
- **`exec`** is the centerpiece for LLMs: one call = one command + its captured
  output + its exit code. Unlike tmux `send-keys` (fire-and-forget; you
  `capture-pane` and guess when the prompt returns), `exec` is synchronous. Two
  tiers: one-shot (`POST /api/exec`) for a self-contained command in a fresh
  shell, and in-session (`POST /api/sessions/:id/exec`) for stateful work where
  cwd/env/aliases/history survive across calls.

## Sessions

```bash
# List every live PTY (attached, dormant, or programmatic/pinned). The `pinned`
# field marks REST-created sessions exempt from idle reap; `clients` is the
# attached-socket count (0 = dormant); `state` is running/alive-quiet/ready.
curl -s "$BASE/sessions"

# Spawn a detached PTY (no browser tab). Pinned by default.
curl -s -X POST "$BASE/sessions" \
  -H 'content-type: application/json' \
  -d '{ "cwd": "/Users/me/project", "command": "git status", "name": "build", "pinned": true }'
# → 201 { "session": { "id": "<uuid>", "pinned": true, "shellName": "zsh", … } }

# One session by id
curl -s "$BASE/sessions/<id>"

# Rename (sets title — the shell may overwrite it) and/or toggle pin.
# A pin change re-arms the idle-reap timer live.
curl -s -X PATCH "$BASE/sessions/<id>" \
  -H 'content-type: application/json' \
  -d '{ "name": "tests", "pinned": false }'

# send-keys: write raw input. Include a trailing \n to execute a line.
curl -s -X POST "$BASE/sessions/<id>/input" \
  -H 'content-type: application/json' \
  -d '{ "data": "make test\n" }'

# capture-pane: the rendered screen as clean text (ANSI processed).
# ?lines defaults to the viewport and extends into scrollback (cap 10000).
curl -s "$BASE/sessions/<id>/pane"
curl -s "$BASE/sessions/<id>/pane?lines=200"

# Resize (cols x rows).
curl -s -X POST "$BASE/sessions/<id>/resize" \
  -H 'content-type: application/json' \
  -d '{ "cols": 120, "rows": 40 }'

# Kill (tears down the PTY and its shell).
curl -s -X DELETE "$BASE/sessions/<id>"
```

### Fields

| field               | meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `id`                | server-side uuid; carry as `?sid=` to attach a browser tab              |
| `pid`               | the PTY child pid                                                       |
| `shell`/`shellName` | full path / basename of the shell                                       |
| `cwd`               | current working directory (tracked from the shell's `cd`)               |
| `title`             | last OSC 0/2 title or cwd-derived title (renameable via PATCH)          |
| `createdAt`         | epoch-ms when spawned                                                   |
| `lastOutputAt`      | epoch-ms of last PTY output (recency sort)                              |
| `clients`           | attached WS sockets (`0` = dormant)                                     |
| `state`             | `running` (recent output) / `alive-quiet` (foreground, quiet) / `ready` |
| `pinned`            | `true` = exempt from idle reap; lives until killed                      |

### CLI

```bash
localterm session ls [--json]
localterm session new [--cwd <path>] [--cmd <command>] [--name <t>] [--cols N] [--rows N] [--no-pin] [--json]
localterm session attach <id>          # open a browser tab at <surface>/?sid=<id>
localterm session kill <id>
localterm session send-keys <id> '<keys>'   # \n = Enter, \xHH = control byte
localterm session capture <id> [--lines N] [--json]
localterm session resize <id> --cols N --rows N
localterm session rename <id> <name>
localterm session pin <id>
localterm session unpin <id>
```

`--json` emits a stable machine shape; without it, commands print human tables
or confirmation lines. `new` prints the session id (or the full object with
`--json`).

## exec

Run a single shell command line, capture its rendered output, and return its
exit code — in one call. The output is ANSI-processed clean text (rendered
through a headless xterm, the same parser the browser uses), so colors,
cursor moves, and alt-screen are resolved to plain text. A start/end marker
pair brackets the captured output in the rendered grid; the markers themselves
are stripped.

### One-shot (`POST /api/exec`)

Spawn a transient shell, run the command, capture, kill the shell. No session
bookkeeping — the 90% case.

```bash
curl -s -X POST "$BASE/exec" \
  -H 'content-type: application/json' \
  -d '{ "command": "pnpm test 2>&1 | tail -20", "cwd": "/Users/me/project", "timeoutMs": 60000 }'
# → { "exitCode": 0, "output": "…", "timedOut": false, "truncated": false, "durationMs": 4321 }
```

### In-session (`POST /api/sessions/:id/exec`)

Same, but inside a persistent session so cwd/env/aliases/history survive
across calls — the tmux `send-keys`+`capture-pane` replacement, but blocking
and one-shot.

```bash
SID=$(curl -s -X POST "$BASE/sessions" -H 'content-type: application/json' \
  -d '{ "cwd": "/Users/me/project" }' | node -pe 'JSON.parse(require("fs").readFileSync(0)).session.id')

curl -s -X POST "$BASE/sessions/$SID/exec" -H 'content-type: application/json' \
  -d '{ "command": "cd src && pwd" }'        # → { "exitCode":0, "output":"/Users/me/project/src", … }

curl -s -X POST "$BASE/sessions/$SID/exec" -H 'content-type: application/json' \
  -d '{ "command": "ls *.ts" }'              # cwd is still src — state survived

curl -s -X DELETE "$BASE/sessions/$SID"      # done — tear it down
```

### CLI

```bash
# One-shot. Text mode prints output and exits with the command's exit code:
localterm exec "pnpm test 2>&1 | tail -20" --cwd /Users/me/project --timeout 60
echo $?            # the command's exit code (124 on timeout)

# One-shot JSON — CLI always exits 0; the exit code is in the payload:
localterm exec "pnpm build" --json --cwd /Users/me/project

# In-session:
localterm session exec <id> "cd src && pwd" --json
localterm session exec <id> "make test" --timeout 120
```

### Request fields

| field              | exec | one-shot | meaning                                              |
| ------------------ | ---- | -------- | ---------------------------------------------------- |
| `command`          | ✓    | ✓        | single shell command line (required)                 |
| `cwd`              |      | ✓        | working directory for the transient shell            |
| `cols`/`rows`      |      | ✓        | terminal size (default 120×32)                       |
| `env`              |      | ✓        | extra env vars for the transient shell               |
| `timeoutMs`        | ✓    | ✓        | default 120000, max 1800000 (30 min)                 |
| `outputLimitBytes` | ✓    | ✓        | default 1MB, max 8MB — output past it is `truncated` |

### Result

```json
{ "exitCode": 0, "output": "…", "timedOut": false, "truncated": false, "durationMs": 4321 }
```

- `exitCode` — the command's exit status, or `null` when it timed out (the
  command may still be running in the session) or the session exited.
- `output` — clean text between the start/end markers. Empty when the command
  produced no output.
- `timedOut` — the command didn't finish within `timeoutMs`. For in-session
  exec, the command is interrupted (Ctrl-C) so the session returns to a prompt;
  for one-shot, the transient shell is killed regardless. Partial output is
  returned.
- `truncated` — `output` was capped at `outputLimitBytes`.
- `durationMs` — wall time of the call.

### Constraints (important for agents)

- **`command` is a single shell line.** The command and its completion marker
  are written on one input line (`;`-chained) so `$?` is the command's exit
  before the next prompt's precmd hooks reset it. Pipes, `&&`/`||`, and
  redirects work (they're one line). For multi-line logic (loops, heredocs,
  multi-step pipelines), write a script and exec it: `exec "bash /tmp/build.sh"`
  — never embed literal newlines in `command`.
- **`exitCode` is the last command's status.** `exec "make && make test"`
  returns `make test`'s exit. Chain explicitly if you need a specific one.
- **A backgrounded command (`&`) returns the launch status**, not the bg job's.
  Use a session + `send-keys` + `capture-pane` for long-running foreground
  processes you want to keep alive, or `exec` with a generous `timeoutMs`.
- **`capture-pane`/exec read the rendered grid**, not infinite history. Output
  that scrolled past the session's scrollback buffer is gone (matches tmux). For
  huge output, raise `outputLimitBytes` or stream via repeated `capture-pane`.

## Errors

`400 {"error":"invalid_body" | "invalid_cwd" | "invalid_lines"}`,
`404 {"error":"not_found"}` (unknown/exited session id), `409 {"error":"capacity"}`
(session cap reached with no evictable dormant slot — pinned sessions hold
theirs). One-shot `exec` never returns `not_found` (it creates its own shell);
it surfaces a shell-side failure as `{ "exitCode": <nonzero>, ... }`.

## Playbook for agents

1. **Default to one-shot `exec`** for stateless commands — no session to
   manage, no cleanup. `localterm exec "<cmd>" --json` (CLI) or `POST /api/exec`
   (REST). The exit code is in the payload; the CLI exits 0 with `--json` so you
   never lose output to a non-zero-exit discard.
2. **Use a pinned session** only when state must survive: a `cd` you want to
   persist, an env that only an rc-sourced alias sets, a REPL/tui you drive with
   `send-keys`. Create it, `exec`/`send-keys` into it across turns, then
   `DELETE` it when done.
3. **Prefer `exec` over `send-keys` + `capture-pane`** whenever you want the
   exit code or want to block until the command finishes — that's most of the
   time. Reserve `send-keys` for driving an interactive program (a REPL, a TUI,
   sending Ctrl-C `\x03`).
4. **Polling, not streaming.** There is no SSE/WebSocket output stream on the
   REST surface today; tail a long build with repeated `capture-pane` (or
   `exec` with a long `timeoutMs`). Streaming is a later add.
5. **Health-check first** and reuse the daemon the user already has running;
   surface a clear "daemon not running" message if `GET /api/health` fails.
6. **Clean up pinned sessions** you created (`DELETE /api/sessions/:id`) — they
   don't self-reap. A leaked pinned session holds a slot until the cap.
