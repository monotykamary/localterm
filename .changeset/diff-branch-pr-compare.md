---
"@monotykamary/localterm-server": minor
---

Add a "compare against a base branch" mode to the diff viewer. Alongside the existing working-tree diff, the viewer can now diff your current working state against a base branch using the merge base — so committed changes on your branch plus any uncommitted/untracked work show up, while changes the base made after you forked don't (the same set GitHub shows for a PR). When the branch's tree is clean this is "the whole PR"; with local edits it's "where I am right now vs base".

The branch's GitHub PR (if any) is detected ambiently for the active directory and surfaced as a state-colored PR indicator (open = green, merged = violet, closed = red) in the terminal toolbar — next to the working-changes count, or on its own when there are no working changes — so a branch with a PR is always one click away from its diff. PR detection uses `gh pr list --head <branch> --state all` (per remote, in parallel), so it finds merged and closed PRs too — not just open ones — and is fork-aware: a PR targeting the upstream of a fork is still found.

The comparison mode is ephemeral (not persisted): the viewer opens in working mode and switches to branch mode when the branch has a PR. Because the PR/branch metadata is leased ambiently and handed to the viewer, opening a PR branch lands on branch mode instantly. The branch base is resolved from local git (`origin/HEAD` → `main`/`master`) and overridable from a branch picker; the branch diff is computed entirely from local git and never blocks on `gh`, so it loads as fast as the working-tree diff. Branch/PR metadata is fetched once per directory (never polled), and `gh` is strictly best-effort: if it's missing or unauthenticated, everything falls back to local git.

New endpoints/options: `GET /api/git/branches` returns the candidate refs, resolved default base, and detected PR; the diff endpoints (`/api/git/diff`, `/git/diff/files`, `/git/diff/file`) accept `mode=working|branch` and an optional `base` ref.
