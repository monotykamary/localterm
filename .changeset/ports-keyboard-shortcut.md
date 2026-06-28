---
"@monotykamary/localterm": minor
---

Add a ⌘/Ctrl+Shift+D keyboard shortcut to open the dev-ports modal, with the matching `⌘⇧D` / `Ctrl+Shift+D` hint surfaced in the command palette's "Dev ports" entry (previously the only action entry without a shortcut hint).

The dev-ports modal shipped without a dedicated shortcut because every plain modifier-letter is already claimed — ⌘K/J/B/G/F/I and ⌘\ are localterm, the rest collide with the browser. The shortcut is a Shift-variant, mirroring the ⌘Shift+B create-worktree precedent: Shift+D reads as "dev ports". Shift+P was the stronger mnemonic but is taken by Dia, and Shift+I is DevTools, so Shift+D is the cleanest free letter in Chromium. The shortcut toggles — press it with the terminal focused to open; Escape closes via the modal's own handler.
