---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add `max` as a thinking level for agent automations. The runner schema accepts `thinking: "max"`, which the pi harness passes through to `pi --thinking` and the `set_thinking_level` RPC, and the automation form's effort picker offers **Max** after Extra high. pi exposes `max` only for models that support it; an unsupported level fails the run with the RPC error in findings, same as `xhigh` today.
