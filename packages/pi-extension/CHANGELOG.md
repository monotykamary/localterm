# @monotykamary/pi-localterm

## 0.4.2

### Patch Changes

- 32aaf4e: Reduce Pi startup time by resolving process secrets concurrently, adding a narrow secret lookup path, and shipping the LocalTerm Pi integration as a guarded JavaScript bundle.

## 0.4.1

### Patch Changes

- chore(deps): update workspace dependencies to latest (excluding @fontsource/geist-mono, which stays pinned at 5.2.7 due to upstream ligature regressions)

## 0.4.0

### Minor Changes

- 50e491b: Redact secret values from captured output so a command that prints them (printenv, a config dump) never leaks into an automation result log or the agent's bash-tool context.

  - Server: automations gain an opt-in `redactOutput` flag. When set, the resolved secret values are carried from launch to the run's exit and redacted from the captured, ANSI-stripped output log before it is stored or served. Resolves values from the existing launch-time backend resolution (no extra Keychain roundtrip); holds them only for the run's life.
  - pi-localterm: the bash-tool operations now wrap the local shell backend and redact every stdout/stderr chunk against the secret values already in pi's own env (no Keychain access, no daemon roundtrip). A value split across onData chunk boundaries is held back by a streaming overlap tail and redacted whole once it completes; the live preview, truncation temp file, and final result all carry redacted values. The existing spawn-side env scrub stays as defense-in-depth.
  - Redaction uses exact known values (user-designated secrets) gated by a length floor, with a single fixed-mask token that avoids leaking value length. No entropy gate (values are explicitly curated, not a fetched env).

## 0.3.2

### Patch Changes

- a385b1e: Emit OSC 9 completion notifications only after Pi settles, including delayed retries coordinated through pi-retry.

## 0.3.1

### Patch Changes

- 9242023: Restore Kitty graphics detection for synchronized terminal probes, initialize Pi image capabilities before its cell-size query, and render inline images at device resolution on HiDPI displays.

## 0.3.0

### Minor Changes

- 37982c6: Surface a truncated excerpt of the agent's final answer in the "pi finished" desktop notification body. The notification previously carried only identity + elapsed time; it now appends a one- to two-sentence preview of what the agent concluded — the last assistant message's text, with thinking and tool-call blocks skipped, whitespace-collapsed and capped at 160 characters with an ellipsis — so a user who stepped away can see what finished, not just that it did. Falls back to the prior `pi finished (…)` / `pi finished: <session> (…)` form when the turn produced no assistant text (e.g. it was aborted mid-tool-use).

## 0.2.0

### Minor Changes

- 30e35c7: Add OSC 9 desktop notifications on agent_end. pi's only notification primitive is an in-TUI banner (`ctx.ui.notify`) that's invisible once you switch away from the pi tab; localterm already has an OSC 9 (`ESC ] 9 ; MESSAGE BEL`) → browser desktop-notification pipeline that's opt-in via "Desktop alerts" in Settings. The extension now writes an OSC 9 on `agent_end`, reusing that pipeline so a user who stepped away from the pi tab gets an OS notification when the agent finishes. Threshold-gated (turns ≥ 30s) so quick back-and-forth doesn't spam a focused user; TUI-mode-guarded so `json`/`rpc`/`-p` stdout isn't polluted with OSC bytes. Note: emitting OSC 9 also fires localterm's `notification` automation trigger, so a `notification`-event automation will fire on agent completion.

## 0.1.2

### Patch Changes

- edf6a41: Bump vite-plus dev dependency to 0.2.2.

## 0.1.1

### Patch Changes

- b1ef114: Update dev dependencies to their latest within-range versions: turbo to 2.10.2, @types/node to 26.1.0, and portless to 0.15.1.

## 0.1.0

### Minor Changes

- Add `@monotykamary/pi-localterm`, a pi extension that integrates localterm with pi. Two features, both inert outside localterm (`LOCALTERM=1`):

  - **Kitty graphics + OSC 8 links** — localterm's xterm.js renderer supports the Kitty graphics protocol and OSC 8 hyperlinks, but sets `TERM=xterm-256color` so pi-tui can't detect them. The extension force-enables them so images and links render in the browser. Ports `pi-localterm-kitty-images` into the monorepo.
  - **Secret scrubbing for pi's bash tool** — localterm injects each secret only into the shimmed process's env (pi's), but pi's bash tool spawns commands with `{ ...process.env }`, so without this the agent's commands would inherit every secret pi received. The extension overrides the `bash` tool with a spawn hook that deletes the `pi` process's localterm-managed secret env vars from each command's child env — pi's own env (and its provider calls) keep them. The strip set is read from `~/.localterm/processes.json` + `secrets.json` (names + env vars only, never values) and refreshed on `session_start`. This is defense-in-depth, not a hard barrier — see the package README for the threat model.
