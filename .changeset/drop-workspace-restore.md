---
"@monotykamary/localterm": patch
---

Stop reopening last workspace tabs via CDP on daemon start. Browser tab restore and session IDs already bring the same tabs back; the Settings toggle and `workspaceRestore` config knob are gone.
