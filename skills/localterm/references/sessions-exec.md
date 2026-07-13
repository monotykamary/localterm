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
# `shell` overrides the daemon's detected default; a non-executable path is
# rejected with 400 invalid_shell. Omit it to use the default (LOCALTERM_SHELL
# → login shell → $SHELL → /bin/sh).
curl -s -X POST "$BASE/sessions" \
  -H 'content-type: application/json' \
  -d '{ "cwd": "/Users/me/project", "command": "git status", "name": "build", "pinned": true, "shell": "/usr/bin/fish" }'
# → 201 { "session": { "id": "<uuid>", "pinned": true, "shellName": "fish", … } }

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
localterm session current [--json]      # self-reference: the id of the session this process runs in
localterm session new [--cwd <path>] [--cmd <command>] [--shell <path>] [--name <t>] [--cols N] [--rows N] [--no-pin] [--json]
localterm session attach <id>          # open a browser tab at <surface>/?sid=<id>
localterm session kill <id>
localterm session send-keys <id> '<keys>'   # \n = Enter, \xHH = control byte
localterm session press <id> <keys...>      # named keys: F2, Ctrl-C, Escape : w q Enter
localterm session capture <id> [--lines N] [--png -o file] [--json]
localterm session wait <id> --text <s> | --regex <p> | --idle-ms N [--timeout s] [--json]
localterm session mouse click <id> --col N --row N | --on-text <s> [--button left|middle|right] [--clicks N]
localterm session mouse drag <id> --from-col N --from-row N --to-col N --to-row N
localterm session mouse move <id> --col N --row N
localterm session mouse scroll <id> up|down [--amount N]
localterm session mouse state <id>
localterm session resize <id> --cols N --rows N
localterm session rename <id> <name>
localterm session pin <id>
localterm session unpin <id>
```

`--json` emits a stable machine shape; without it, commands print human tables
or confirmation lines. `new` prints the session id (or the full object with
`--json`).

### Self-reference: which session am I in?

Every PTY localterm spawns gets `LOCALTERM_SESSION_ID` injected into its env
(set in the server at spawn, inherited by every child process — shells, nested
`localterm` calls, agent tool processes). `LOCALTERM=1` says "I'm inside a
localterm PTY"; `LOCALTERM_SESSION_ID` says _which one_.

```bash
# Zero-dependency, no daemon needed — read the id directly:
echo "$LOCALTERM_SESSION_ID"

# Resolve it to the full live session object (cwd, title, state, clients):
localterm session current
localterm session current --json    # → the session object (same shape as `ls --json` rows)
```

Use this when an agent needs its own context (cwd, title, how many tabs are
viewing this shell) without scanning `session ls` and guessing which row is
its own — the env var is the unambiguous self-reference. `current` resolves
the env id against `GET /api/sessions/:id`; if the daemon is down it degrades
to the bare id (still a valid self-reference), and if the id isn't a live
session (stale/spoofed env) it reports that and exits 1. Run from a plain
terminal (outside any localterm PTY) it prints "not running inside a
localterm session" and exits 1.

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

# One-shot in a specific shell (overrides the daemon default):
localterm exec "fish -c 'echo \$fish_version'" --shell /usr/bin/fish --json

# In-session (the session's shell is fixed at spawn — `--shell` is create/new only):
localterm session exec <id> "cd src && pwd" --json
localterm session exec <id> "make test" --timeout 120
```

### Request fields

| field              | exec | one-shot | meaning                                                 |
| ------------------ | ---- | -------- | ------------------------------------------------------- |
| `command`          | ✓    | ✓        | single shell command line (required)                    |
| `cwd`              |      | ✓        | working directory for the transient shell               |
| `shell`            |      | ✓        | absolute shell path; non-executable → 400 invalid_shell |
| `cols`/`rows`      |      | ✓        | terminal size (default 120×32)                          |
| `env`              |      | ✓        | extra env vars for the transient shell                  |
| `timeoutMs`        | ✓    | ✓        | default 120000, max 1800000 (30 min)                    |
| `outputLimitBytes` | ✓    | ✓        | default 1MB, max 8MB — output past it is `truncated`    |

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

## terminal-use parity: press, wait, screenshots, mouse

Built on the insight that the daemon's existing CDP socket (the one `localterm
start` opened for background-tab automation) plus the tmux-parity surface above
compose with no new deps. The browser (already a hard dep for the viewer) is the
PNG rasterizer; xterm.js (already speaking SGR mouse natively) is the mouse
encoder; the headless capture renderer is the render-landed source of truth and
the no-browser fallback. Every CDP call reuses the daemon's one persistent
socket — no second connection, no per-call reconnect.

### press (named keys)

`send-keys` for humans: `press F2` / `press Ctrl-C` / `press Escape : w q Enter`
instead of `send-keys '\x1bOQ'`. Space-separated tokens; a known name maps to its
xterm bytes, an unknown token passes through as literal text so `press hello`
types "hello". Same route as send-keys with `named:true`.

```bash
curl -s -X POST "$BASE/sessions/<id>/input" \
  -H 'content-type: application/json' \
  -d '{ "data": "Escape : w q Enter", "named": true }'

localterm session press <id> Escape : w q Enter
localterm session press <id> Ctrl-C
```

### wait

Block until the rendered pane matches a predicate or goes idle — the primitive
for interactive apps so you don't poll. Tests the flushed capture-renderer grid
(the same source `capture-pane` reads), not raw bytes. Resolves on match,
timeout, or shell exit. Exits 0 on match, 1 on timeout (CLI).

```bash
curl -s -X POST "$BASE/sessions/<id>/wait" \
  -H 'content-type: application/json' \
  -d '{ "mode": "text", "text": "Complete", "timeoutMs": 10000 }'
# → { "matched": true, "elapsedMs": 1234, "snapshot": "<rendered pane now>" }

# regex + idle modes:
curl -s -X POST "$BASE/sessions/<id>/wait" \
  -H 'content-type: application/json' -d '{ "mode": "regex", "regex": "error:|done", "timeoutMs": 10000 }'
curl -s -X POST "$BASE/sessions/<id>/wait" \
  -H 'content-type: application/json' -d '{ "mode": "idle", "idleMs": 500, "timeoutMs": 10000 }'

localterm session wait <id> --text "Complete" --timeout 10
localterm session wait <id> --regex "error:|done" --timeout 10
localterm session wait <id> --idle-ms 500 --timeout 10
```

### capture --png (screenshots)

`capture-pane` rasterized to a PNG by the browser over the daemon's CDP socket.
Reuses a live viewer tab for the session when one exists (zero spawn latency,
render already current); otherwise opens an ephemeral background tab, waits for
xterm to render the session's current state, `Page.captureScreenshot`s the
`.xterm` element, and closes the tab. Pinned sessions (the REST default)
survive between calls with no tab burning a slot. `?format=png` on the pane
route; CLI `--png -o file`.

```bash
curl -s "$BASE/sessions/<id>/pane?format=png" -o shot.png
# no browser reachable → 409 {"error":"no_browser"} (text capture-pane still works)

localterm session capture <id> --png -o shot.png
localterm session capture <id> --png --json   # → { "path": "pane-…png", "bytes": 12345 }
```

### mouse

Drive a TUI with the mouse. Primary path dispatches a real event through the
tab's xterm.js (SGR generated natively — exact drag/scroll/click-count
semantics with no encoder) over the CDP socket; falls back to direct SGR-1006
bytes written to the PTY when no browser is reachable (true-headless), gated on
the session's mouse-tracking mode so bytes are never fed to an app that didn't
enable mouse. `--on-text` resolves a label's coords on the server-side capture
grid (no tab needed) so the fallback can also locate a label.

```bash
# by coords or by label
curl -s -X POST "$BASE/sessions/<id>/mouse" \
  -H 'content-type: application/json' \
  -d '{ "action": "click", "col": 50, "row": 20 }'
curl -s -X POST "$BASE/sessions/<id>/mouse" \
  -H 'content-type: application/json' \
  -d '{ "action": "click", "onText": "OK", "clicks": 2 }'
# drag / move / scroll
curl -s -X POST "$BASE/sessions/<id>/mouse" \
  -H 'content-type: application/json' \
  -d '{ "action": "drag", "fromCol": 10, "fromRow": 5, "toCol": 30, "toRow": 15 }'
curl -s -X POST "$BASE/sessions/<id>/mouse" \
  -H 'content-type: application/json' -d '{ "action": "scroll", "direction": "down", "amount": 5 }'
# state: is mouse tracking on? + viewport size
curl -s "$BASE/sessions/<id>/mouse/state"

localterm session mouse click <id> --col 50 --row 20
localterm session mouse click <id> --on-text OK --clicks 2
localterm session mouse scroll <id> down --amount 5
```

Result: `{ "ok": bool, "mode": "cdp"|"sgr", "col": int|null, "row": int|null,
"text": string|null, "reason": string|null }`. `mode` tells an agent whether the
gesture reached a real xterm (`cdp`) or was synthesized as SGR bytes (`sgr`).
`reason` is set on a miss (`text_not_found`, `mouse_disabled`, `no_browser`,
`out_of_bounds`).

### When to use what

- **`exec`** for stateless command+output+exit.
- **`send-keys`/`press`** to drive an interactive program keystroke by keystroke.
- **`wait`** to block until a TUI reaches a state instead of polling.
- **`capture --png`** when layout/color carries meaning a text read can't (a
  dialog, a colored diff) and a browser is reachable; `capture-pane` (text)
  otherwise — it works with no browser.
- **`mouse`** for mouse-first TUIs (NetHack, `dialog` installers, `mc`) — open
  a viewer tab once (`session attach <id>`) so every gesture reuses it instead
  of opening ephemeral tabs per call.
