---
"@monotykamary/localterm-server": patch
---

Seed the session frame with the live title on reattach instead of the frozen spawn-cwd title. A silently reattached tab (WS drop across laptop sleep or a transient blip while the PTY stayed parked) previously reverted its document/tab title to the directory the shell was spawned in — because the reattach frame sent `initialDocumentTitle`, which is computed once at spawn and never updated. The frame now sends `currentTitle` (the title the tab was last showing), so a reattached tab keeps its current directory's title instead of flipping back to the original cwd until the next prompt corrects it.
