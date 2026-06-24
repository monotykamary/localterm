---
"@monotykamary/localterm-server": patch
---

Broadcast git-diff-summary to every tab sharing a cwd so sibling directory tabs stay in sync. A git operation run inside one of two side-by-side tabs previously updated only that tab's metadata — its shell's precmd OSC hook fired, but the idle sibling got no signal and stayed stale until its own next prompt (or a lucky fs.watch event). A per-cwd GitDirtyCoordinator now dedups the summary computation and fans the recomputed summary out to all subscribed sockets, so both tabs refresh together and the branch/PR lease re-leases off the updated branch.
