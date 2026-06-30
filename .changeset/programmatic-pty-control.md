---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add programmatic PTY control (tmux parity) over the REST API and the `localterm session` CLI, plus `exec` — the synchronous command+output+exit-code primitive for AI agents.

- **Sessions**: `POST /api/sessions` (spawn a detached, pinned-by-default PTY), `GET/PATCH /api/sessions/:id` (rename/pin), `POST /api/sessions/:id/{input,resize,exec}`, `GET /api/sessions/:id/pane` (capture-pane), `DELETE /api/sessions/:id` (existing). CLI: `localterm session ls|new|attach|kill|send-keys|capture|exec|resize|rename|pin|unpin`.
- **exec**: one-shot `POST /api/exec` / `localterm exec` (transient shell, run+capture+exit) and in-session `POST /api/sessions/:id/exec` (stateful — cwd/env/history persist across calls). Returns `{exitCode, output, timedOut, truncated, durationMs}`; the CLI propagates the exit code (text mode) or emits JSON (exits 0, code in the payload).
- **Pinned sessions**: REST-created sessions are exempt from the idle reap and from silent eviction at the session cap, so an agent's shell survives between calls. Browser tabs keep the grace window. `--no-pin` / `pinned:false` opt out.
- **Server-side terminal emulation**: a lazy per-session `@xterm/headless` renderer (same parser as the browser) feeds `capture-pane` and exec clean, ANSI-processed text. Loaded via `createRequire` to work around the package's missing `exports` field.
- **Skills**: a new `references/sessions-exec.md` reference plus an updated `SKILL.md` so LLMs can drive the surface.
