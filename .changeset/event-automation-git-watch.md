---
"@monotykamary/localterm-server": minor
---

Event automations now detect git ref changes from any source, not just a live
localterm session. A new daemon-global `AutomationGitWatcher` arms a recursive
`fs.watch` per event-automation cwd that selects at least one git event, and on
`.git` changes classifies the affected repo (reusing the per-session
`GitDiffWatcher` machinery) — emitting the same ref events
(`git-commit`/`git-merge`/`git-fetch`/…) into `SessionEventManager`.

This closes the gap where a commit from a non-localterm process — a headless
agent run, an editor, an SSH session — or a commit in a repo with no open
localterm tab produced no event, because `git-commit` was emitted only by a
live session's per-session `GitDiffWatcher` fs.watching that repo's `.git`.
New repos created after the watch armed are covered: `git init` seeds the empty
tree, then the first commit classifies against it. Dependency caches under
`node_modules` are excluded so installs don't spuriously fire automations.
