---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Show a fork PR's upstream base in the diff viewer picker, not the fork's origin.

The diff viewer's base picker displayed `branchInfo.defaultBase` (always
`origin/...` from the fast local lease), so even after the server-side diff
compared a fork PR against its upstream base, the picker still read "origin" —
a mismatch between what the picker showed and what the diff actually compared.

The PR's base ref is now resolved once in `detectPr` (mapping the PR's base repo
to a local remote, fetching the upstream branch when missing) and surfaced on the
wire as `pr.baseRef`. The picker prefers it: a fork PR shows `upstream/<base>`
and a same-repo PR (base repo is origin) shows `origin/<base>` — automatic from
the remote-slug match, so normal PRs stay on the same remote. Falls back to the
repo default when there's no PR or the base couldn't be resolved.
