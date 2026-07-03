---
"@monotykamary/localterm": patch
---

Size the diff viewer's base-branch picker to the branch name it actually renders.

With no remote, the repo's default base resolves to `null` (the current branch is the only candidate), so the picker's `<select>` had `value=""`. React then selects the first non-disabled option and displays a real branch name, but the select's width was measured from the empty string — clipping the name to its first couple of characters. The width is now measured from the actually-rendered label (the resolved base, or the first branch / the `Loading…` / `No branches` placeholder when none resolves), so the picker is always wide enough for what it shows.
