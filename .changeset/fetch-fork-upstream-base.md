---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fetch a fork PR's upstream base ref when it isn't local, and resolve the PR on a cold cache.

The previous fork-PR fix only resolved the base through existing remote-tracking
refs — but the server never fetches, so a fork with `upstream` configured but
never `git fetch upstream`'d had no `upstream/main` ref and silently fell back to
the fork's own origin. Three failure modes now closed:

- Missing upstream ref: when the upstream remote is configured but its tracking
  ref isn't local (the common fork state), `git fetch <remote> <branch>` (one
  branch, no tags/submodules, bounded by the spawn timeout and
  GIT_TERMINAL_PROMPT=0) creates it. A dead/slow upstream degrades to the repo
  default.
- Cold PR cache: opening branch mode (manually, or via refresh) before
  `getGitBranchPr` landed used to silently fall back to origin. The diff path now
  resolves the PR inline via a deduped `detectPr` that shares any in-flight
  `getGitBranchPr` call, so it never races into a second GitHub round-trip.
- Case-insensitive remote slug match: GitHub repos are case-insensitive and a
  remote URL's casing can differ from the API's canonical `full_name`.
