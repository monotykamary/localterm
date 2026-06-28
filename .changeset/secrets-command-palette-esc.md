---
"@monotykamary/localterm": patch
---

Add the secrets modal to the command palette and fix Escape closing it.

The secrets modal was the only overlay missing a command-palette entry — the toolbar's Secrets button already opened it, but ⌘/Ctrl+K → "Secrets" didn't. The palette now lists a "Secrets" action (Key icon, no shortcut) that opens the modal through the same `handleSecretsOpenChange` handler sessions/ports/worktrees/automations/QR use, so opening it dismisses the actions menu and command palette and closing it hides the toolbar and refocuses the terminal.

Escape also now actually closes the secrets modal. Its keydown listener ran on the bubble phase with no `preventDefault`/`stopPropagation`, so the terminal's own Escape handler swallowed the key before it reached `window`. The handler now mirrors every other modal — capture phase, `preventDefault` + `stopPropagation`, `mounted`-gated — while keeping the form-cancel-first behavior (Escape drops an open edit form back to the list instead of closing the modal), which the footer hint already advertised.
