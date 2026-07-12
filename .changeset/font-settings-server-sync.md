---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Promote terminal font settings to daemon-managed state, mirroring themes. The
active font id, the user-entered custom family, and the Nerd Font / ligatures
toggles are now stored in `~/.localterm/fonts.json` and shared with the
`localterm font` CLI and every browser tab — so a custom font set in one browser
profile (or from the CLI) loads by default in a new terminal, instead of being
stranded in per-browser `localStorage` (which is scoped per profile, so a
custom font never followed you across profiles/devices the way a custom theme
already did).

- Server: a `FontStore` (`~/.localterm/fonts.json`, v1) with `GET`/`PUT /fonts`
  and a one-time `POST /fonts/migrate`, broadcasting `{type:"fonts"}` over each
  tab's WebSocket on every mutation. The built-in font catalog moves into a
  shared `terminal-fonts.ts` (re-exported by the app, which keeps the
  browser-only CSS `family` string the daemon never stores).
- CLI: `localterm font list|get|set|family|nerd-font|ligatures`, with
  tab-completion (`font set` completes built-ins + `custom`; the two toggles
  complete `on`/`off`).
- Terminal: reconciles against the daemon on mount, pushes each font change to
  it, and applies the `{type:"fonts"}` broadcast; a one-time migration moves
  the legacy `localStorage` font state into the store on first contact with an
  uninitialized one, so an upgrade never loses the user's font selection.
