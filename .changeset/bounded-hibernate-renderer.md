---
"@monotykamary/localterm-server": patch
---

Bound headless terminal rendering under sustained PTY output by coalescing parser writes and pausing the PTY at renderer queue watermarks. This prevents hibernation history capture from retaining an unbounded JavaScript heap when chatty agents outrun xterm parsing.
