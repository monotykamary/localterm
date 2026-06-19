---
"@monotykamary/localterm": patch
---

Make the worktree modal height dynamic (content-sized up to a max) and animate the worktree list in on load instead of flashing a spinner.

- Modal now sizes to its content with a `min(100%, 40rem)` cap instead of always filling to the max height, so short worktree lists no longer leave a large empty panel.
- On load, the body starts at one row's height and animates smoothly to the virtualizer's total height; the in-body loading spinner is removed (the header spinner still signals loading) and the list fades in over 150ms.
