---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add `localterm session current` — a single self-reference call that resolves
the localterm session the calling process is running in, so an agent inside a
PTY can get its own context (id, cwd, title, state, attached-tab count) without
scanning `session ls` and guessing which row is its own.

The daemon now injects `LOCALTERM_SESSION_ID` into every PTY's env at spawn
(inherited by all child processes), so the id is always locally available:
`echo "$LOCALTERM_SESSION_ID"` reads it with no daemon call, and
`localterm session current` (or `--json`) resolves it against
`GET /api/sessions/:id` for the full live session object. It degrades to the
bare id when the daemon is unreachable, and reports and exits non-zero when
not running inside a localterm PTY or when the env id isn't a live session.

- Server: stamp `LOCALTERM_SESSION_ID` on every spawned PTY; add it to the
  `PTY_ENV_DENYLIST` so a daemon spawned inside a tab can't leak its own.
- CLI: `localterm session current [--json]`, reusing the existing
  `GET /api/sessions/:id` (no new endpoint).
- Docs: the localterm skill and the sessions/exec reference cover the env var,
  the command, and the degrade/error semantics.
