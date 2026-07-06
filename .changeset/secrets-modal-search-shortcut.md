---
"@monotykamary/localterm": minor
---

Add a search filter to the secrets modal and a keyboard shortcut to open it.

The secrets modal gains a search bar (autofocused on open) that filters whichever tab is active: on Secrets it matches the secret's name and env var, on Processes it matches the process's binary name and any of its requested secrets. The list virtualization is preserved while filtering, the add/edit form's secret selector is left unfiltered (only the visible rows narrow), and the empty state distinguishes "no matches" from "nothing yet." Search resets on open and on tab switch so a stale filter never hides rows.

The secrets modal also gets a command-palette entry with a shortcut: ⌘/Ctrl+Shift+S toggles it. Plain ⌘S is a hard no-go (browser save, the same reason the sessions shortcut avoided it), so Shift is required — ⌘Shift+S isn't a Chrome/Edge/Safari/Firefox/Arc/Dia default and a shifted save press isn't muscle memory. No plain letter is free (F/G/J/B/I/K are localterm, the rest collide with browser defaults), so a Shift+letter is the only option, matching the ports (⌘Shift+D) and create-worktree (⌘Shift+B) precedents.
