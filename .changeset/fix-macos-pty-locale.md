---
"@monotykamary/localterm-server": patch
---

Default macOS PTYs to a UTF-8 locale when launchd provides none, preventing locale-sensitive clipboard tools from turning copied Unicode text into MacRoman mojibake.
