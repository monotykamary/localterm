---
"@monotykamary/localterm": minor
---

Add a "New shell" button to the sessions modal footer so the new-tab action — removed from the toolbar when it was replaced by the QR button — stays reachable from inside the session switcher. The button opens a new browser tab to the current working directory's shell URL via the same `window.open` path the "Shell ended" dialog uses, then runs the modal's close path (toolbar-hover cleanup + terminal refocus).

On touch devices the footer's keyboard hints (`↑↓` / `↵` / `esc`) are hidden — they're dead weight without a keyboard — so the button becomes the sole footer affordance there. The hidden `#new-shell-link` anchor, the `Alt+T`/`⌘T` shortcut, and the command-palette "Open new shell" entry are untouched.
