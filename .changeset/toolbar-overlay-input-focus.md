---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix input handling in the top-right overlay: the find overlay stayed visible but became click-through once the toolbar hover timer fired (clicks fell through to the terminal and it could not be refocused), and the toolbar's focus-preserving mousedown/keydown handlers also fired for the portaled automations/settings popovers, making their inputs unfocusable and sending typed text to the terminal.
