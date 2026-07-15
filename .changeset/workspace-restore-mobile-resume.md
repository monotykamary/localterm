---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Reopen your last workspace tabs on start, and resume your active shell on mobile.

- On daemon start, reopen the browser tabs you had open last — in the same
  directories and shells — via the automation browser's CDP connection: a
  tmux-resurrect/herdr-style restore of the workspace layout. The shells
  themselves don't survive a stop, so only the arrangement comes back;
  automation-run tabs and shells you'd closed are skipped. Opt out from
  Settings → Sessions ("Reopen tabs on start").
- On phones and tablets, opening localterm attaches to your most recently
  active shell instead of starting a new one, so you land on the build or
  agent run you just started on another device. An explicit attach (a shared
  session QR) always wins regardless. Opt out from Settings → Launch
  ("Resume last shell on mobile").
