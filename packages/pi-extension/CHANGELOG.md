# @monotykamary/pi-localterm

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
