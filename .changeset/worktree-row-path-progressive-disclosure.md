---
"@monotykamary/localterm": patch
---

Declutter the worktrees list by hiding each row's directory path and short SHA
until the row is hovered or keyboard-focused, so the list reads as a clean
branch-only summary by default and reveals a worktree's location + commit only
on demand.

The path line keeps its space via opacity (not collapse), so the virtualized
row height never shifts on hover — mirroring the existing row-action button
reveal, which already hides the open-in/remove buttons until hover/focus.
