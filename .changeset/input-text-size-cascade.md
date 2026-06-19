---
"@monotykamary/localterm": patch
---

Fix oversized input/textarea text on desktop that ignored `text-xs`. The default `Input`/`Textarea` classes used `text-base md:text-sm`; when a component overrode with `text-xs`, `tailwind-merge` stripped the conflicting base `text-base` but kept `md:text-sm` (a different variant), so `md:text-sm` (14px) won over `text-xs` (12px) at desktop widths. Swapped the base to plain `text-sm` so `text-xs` overrides cleanly at every breakpoint and dropped the `text-xs md:text-xs` band-aid it required. Affects the worktrees PR number field, setup-script and `.worktreeinclude` textareas, keep-awake caffeinate command input, diff-viewer line-comment box, and the find-in-terminal search input.
