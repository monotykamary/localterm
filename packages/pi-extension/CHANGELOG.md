# @monotykamary/pi-localterm

## 0.1.0

### Minor Changes

- Add `@monotykamary/pi-localterm`, a pi extension that integrates localterm with pi. Two features, both inert outside localterm (`LOCALTERM=1`):

  - **Kitty graphics + OSC 8 links** — localterm's xterm.js renderer supports the Kitty graphics protocol and OSC 8 hyperlinks, but sets `TERM=xterm-256color` so pi-tui can't detect them. The extension force-enables them so images and links render in the browser. Ports `pi-localterm-kitty-images` into the monorepo.
  - **Secret scrubbing for pi's bash tool** — localterm injects each secret only into the shimmed process's env (pi's), but pi's bash tool spawns commands with `{ ...process.env }`, so without this the agent's commands would inherit every secret pi received. The extension overrides the `bash` tool with a spawn hook that deletes the `pi` process's localterm-managed secret env vars from each command's child env — pi's own env (and its provider calls) keep them. The strip set is read from `~/.localterm/processes.json` + `secrets.json` (names + env vars only, never values) and refreshed on `session_start`. This is defense-in-depth, not a hard barrier — see the package README for the threat model.
