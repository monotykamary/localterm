# Secrets & sessions

This reference covers the two resource surfaces the automations skill doesn't: **secrets** (per-program secret injection) and **sessions** (live PTYs). For the automations surface, see [SKILL.md](../SKILL.md#automations).

## Secrets

Per-program secret injection. API keys live in the macOS Keychain (never plaintext on disk), and the daemon generates a PATH shim per program that resolves the secret and `exec`s the real binary — so only the shimmed program's process sees the value, not its parent shell. The policy (which programs get which secret as which env var) lives in `~/.localterm/secrets.json`; **only names, never values**.

### Critical: values never come back over the API

The `/api/*` surface is gated by a **network-origin** check (loopback/tailnet), not a capability check — any local process can reach it via `curl`. So the daemon **never** returns secret values over HTTP. The list response carries `hasValue` (probed from the Keychain without reading the value into memory) so a UI can show "set / no value" without ever exposing the secret. To read a value, use the CLI's `get` (which resolves from the Keychain directly, not the API) or the generated shim.

The one place values _do_ reach a process other than the shimmed binary is **automations**: an automation may name secrets it needs, and the daemon resolves them into the run's PTY (shell) or subprocess (agent) environment at spawn. This preserves the property above — the value goes Keychain → daemon → run env, never over HTTP. See [Automation secret exposure](#automation-secret-exposure) below.

### Endpoints

```bash
PORT=$(cat ~/.localterm/server.port 2>/dev/null || echo 3417)
BASE="http://127.0.0.1:$PORT/api"

# List — names + policy + hasValue (never values)
curl -s "$BASE/secrets"
# → {
#   "supported": true,
#   "shimsDir": "/Users/me/.localterm/shims",
#   "secrets": [
#     {"name":"anthropic-api-key","envVar":"ANTHROPIC_API_KEY","programs":["pi","claude"],"hasValue":true}
#   ]
# }

# Upsert (create or update). value is optional for an UPDATE (policy-only
# change); required for a CREATE (the daemon rejects a value-less create with
# value_required). On a successful save the value is stored in the Keychain and
# the shim is regenerated.
curl -s -X PUT "$BASE/secrets/anthropic-api-key" \
  -H 'content-type: application/json' \
  -d '{"envVar":"ANTHROPIC_API_KEY","programs":["pi","claude"],"value":"sk-ant-…"}'
# → {"name":"anthropic-api-key","envVar":"ANTHROPIC_API_KEY","programs":["pi","claude"],"hasValue":true}

# Delete — removes the policy entry AND the Keychain value, then regenerates shims.
curl -s -X DELETE "$BASE/secrets/anthropic-api-key"
# → {"ok":true}
```

### Field validation

- `name` (in the URL path) — `^[A-Za-z0-9][A-Za-z0-9_-]*$` (alphanumeric, `-` or `_`).
- `envVar` — `^[A-Z_][A-Z0-9_]*$` (uppercase with `_`).
- `programs` — array of binary names (`^[A-Za-z0-9_.+-]+$`), comma-separated in the CLI. A PATH shim is generated per program.
- `value` — 1–8192 bytes; optional on update.

### Error responses

`400 {"error":"invalid_name" | "invalid_body" | "value_required"}`, `404 {"error":"not_found"}` (DELETE on an unknown name), `409 {"error":"unsupported" | "capacity" | "backend"}`. `unsupported` means the daemon's platform has no secret backend (it uses macOS Keychain; run the daemon on a Mac).

### CLI

```bash
# List (names + policy; never values)
localterm secret list

# Print a value — resolved from the Keychain DIRECTLY, not via the daemon's
# HTTP API (so the value never crosses the network). Works with the daemon down.
# Output has a trailing newline; $(...) strips it for `VAR=$(localterm secret get x)`.
localterm secret get anthropic-api-key

# Create/update. -v <value> passes the value as a CLI arg (briefly visible to
# `ps`, same trade-off as the daemon's `security add -w`); -v - reads from stdin
# (the secure path — no argv exposure); omit -v for a policy-only update.
localterm secret set anthropic-api-key -e ANTHROPIC_API_KEY -p pi,claude -v -
localterm secret set anthropic-api-key -e ANTHROPIC_API_KEY -p pi,claude    # policy-only

# Delete
localterm secret delete anthropic-api-key
```

`get` and `set`/`delete` use different paths deliberately: `get` resolves from the Keychain (no daemon needed, no network), while `set`/`delete` go through the daemon (the policy is the daemon's source of truth). `get` resolves the backend by platform, so on non-darwin it reports unsupported.

### How the shim works

For each program in any secret's `programs` list, the daemon writes `~/.localterm/shims/<program>`:

```sh
#!/bin/sh
_shim_dir='/Users/me/.localterm/shims'
_rest=
IFS=:
for _d in $PATH; do [ "$_d" = "$_shim_dir" ] && continue; _rest=${_rest:+$_rest:}$_d; done
IFS=$_oldifs
_real=$(PATH=$_rest command -v 'pi') || { printf 'localterm: pi not found on PATH\n' >&2; exit 127; }
_v=$(/usr/bin/security find-generic-password -s 'localterm:anthropic-api-key' -a localterm -w 2>/dev/null || true)
[ -n "$_v" ] && ANTHROPIC_API_KEY=$_v && export ANTHROPIC_API_KEY
exec "$_real" "$@"
```

localterm's zsh/bash shell hook prepends the shims dir to PATH **after** the user's rc files run (so a later `export PATH=/opt/homebrew/bin:$PATH` in `.zshrc` can't shadow the shim), and strips the shims dir before resolving the real binary (no recursion). The secret exists only in the shimmed process's env, not the parent shell — `ls` in the same tab never sees `ANTHROPIC_API_KEY`.

### Automation secret exposure

Automations run arbitrary code — a shell `command` typed into a tab (shell runner) or an agent `prompt` run headlessly as a subprocess (agent runner) — so a secret in that run's env can be exfiltrated. Exposure is therefore **per-automation, opt-in, and least-privilege**: each automation names exactly the secrets it needs via `requestedSecrets` (a list of secret **names** — the stable identifier, not the env var), and only those resolve into the run's environment (PTY for shell, subprocess for agent). An automation with `requestedSecrets: []` (the default) gets no secrets; the run alone can never reach a key the automation didn't explicitly request.

Resolution happens at **launch time**, not claim time: when a run fires (schedule/watch/event/webhook/manual), the daemon resolves each named secret from the Keychain in parallel and stores the env on the pending run before the run starts. For a **shell** run this is before the run tab is claimed (the WS that claims it is guaranteed to see the resolved env; the synchronous spawn path passes it through); for an **agent** run there is no tab — the env is resolved before the harness subprocess spawns. Resolution is fail-closed on both ends:

- **At create/update** — unknown secret names (typos, or deleted-before-you-saved) are rejected with `400 {"error":"invalid_secret"}`.
- **At run time** — a name deleted after the automation was authored, or a secret with no value (locked Keychain / never set), is silently skipped; it never clobbers a pre-existing env var with an empty string.

Values flow Keychain → daemon → run env and never cross the HTTP surface, so the network-origin gate on `/api/*` is not widened. The env lives only in the run's process — the shell for a shell run, or the agent harness subprocess for an agent run (and its children, e.g. `node scripts/update-models.js`) — not the parent daemon or any other tab.

```bash
# Grant an automation the keys it needs (names from `localterm secret list`)
curl -s -X POST "$BASE/automations" \
  -H 'content-type: application/json' \
  -d '{
    "name": "update all provider models",
    "trigger": { "kind": "schedule", "schedule": { "kind": "daily", "hour": 2, "minute": 0 } },
    "cwd": "/Users/me/open-source",
    "runner": { "kind": "shell", "command": "bash update-all-models.sh" },
    "requestedSecrets": ["neuralwatt_api_key","deepseek_api_key","moonshot_api_key"]
  }'

# Add or remove a secret from an existing automation (PATCH is replace-semantics
# for the whole list — send the complete set you want)
curl -s -X PATCH "$BASE/automations/<id>" \
  -H 'content-type: application/json' \
  -d '{ "requestedSecrets": ["neuralwatt_api_key","deepseek_api_key"] }'
```

A requested secret is resolved to its policy `envVar`, so renaming a secret's env var doesn't break automations that name it — only deleting the secret (by name) does, and that surfaces as a skipped var at run time, not a crash.

## Sessions

Every live PTY the daemon has spawned (attached or dormant — a shell left behind by a closed tab stays alive). The session picker surfaces these so a tab can switch to one by id or kill one it no longer wants.

### Endpoints

```bash
# List every live PTY
curl -s "$BASE/sessions"
# → {"sessions":[{"id":"<uuid>","pid":12345,"shell":"/bin/zsh","shellName":"zsh",
#                  "cwd":"/Users/me/project","title":"…","createdAt":…,"lastOutputAt":…,
#                  "clients":1,"state":"running"}, …]}

# Kill a session by id (the underlying PTY child is signalled)
curl -s -X DELETE "$BASE/sessions/<id>"
# → {"ok":true}  |  404 {"error":"not_found"}
```

### Fields

| field          | meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `id`           | server-side uuid; carry back as `?sid=` on the WS url to reattach                            |
| `pid`          | the PTY child pid                                                                            |
| `shell`        | full path to the shell binary                                                                |
| `shellName`    | basename of the shell                                                                        |
| `cwd`          | current working directory (tracked from the shell's `cd` output)                             |
| `title`        | last OSC 0/1/2 title the shell set                                                           |
| `createdAt`    | epoch-ms when the session was spawned                                                        |
| `lastOutputAt` | epoch-ms of the last PTY output (for recency sorting)                                        |
| `clients`      | count of attached WS sockets (`0` = dormant — alive but nobody viewing)                      |
| `state`        | `"running"` (recent output) / `"alive-quiet"` (foreground program, quiet) / `"ready"` (idle) |

`state` is the favicon-equivalent activity used to color the session row and gate the dormant-idle reap; `clients:0` marks the dormant shells the picker exists to surface.
