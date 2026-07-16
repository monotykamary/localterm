---
"@monotykamary/localterm": patch
---

Treat whitespace-only assistant text (a one-space response the model emits alongside its thinking before a tool call) as no response in the automations agent thread preview: keep the intended blank line after the thinking trace, stop rendering the empty response block, and skip the entry's trailing blank line so there is no extra unindented blank line above the following tool call.
