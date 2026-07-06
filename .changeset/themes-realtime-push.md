---
"@monotykamary/localterm-server": minor
---

Push terminal theme changes to open tabs in realtime over the WebSocket.

Theme mutations (import / set active / delete / migrate) now broadcast the full
theme state to every open tab's PTY WebSocket as
`{type:"themes", activeThemeId, customThemes, initialized}`, so a
`localterm theme set`/`import`/`delete` — or a change made in another browser
tab — updates every open terminal instantly. The browser applies the pushed
state directly; the 15 s reconcile poll is gone, replaced by a one-shot mount
read (plus the one-time `localStorage`→server migrate on first contact with an
uninitialized store).
