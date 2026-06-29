---
"@monotykamary/localterm-server": patch
---

Fix the ambient PR indicator never showing for a same-repo branch, and for partial/blobless clones.

**Same-repo PRs (the primary bug).** PR detection queried the GitHub REST `pulls.list` with `head=owner:branch`, but that `head` form only matches _fork_ PRs — for a same-repo PR (the common case where you push to `origin` directly) it returns 0 results, and a bare branch name is silently ignored (returns all PRs). So a branch with an open PR against its own origin repo was never detected and the toolbar PR indicator never appeared, while fork PRs worked. The fetcher now uses a GraphQL `pullRequests(headRefName:)` query — the same semantics `gh pr list --head` uses — which filters by branch name across same-repo and fork PRs alike. The `headRepositoryOwner === origin owner` filter is retained so a stranger's same-named fork PR can't claim a common branch like `main`. GraphQL also returns `mergeable` in the same query, so the per-PR detail round-trip is gone.

**Partial/blobless clones.** `parseGithubRemotes` matched each `git remote -v` fetch line with `/^(\S+)\t(.+?)\s+\(fetch\)$/`, anchoring `(fetch)` to the end of the line. A partial clone (e.g. `git clone --filter=blob:none`) annotates the fetch line with the filter spec — `origin\t<url> (fetch) [blob:none]` — so the trailing ` [blob:none]` broke the anchor, no remote matched, and PR detection silently no-op'd on partial clones. The regex now tolerates the optional trailing filter annotation (`[blob:none]`, `[tree:0]`, `[blob:limit=1m]`, …).
