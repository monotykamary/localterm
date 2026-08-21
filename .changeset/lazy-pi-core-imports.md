---
"@monotykamary/pi-localterm": patch
---

Pi-launch perf: register the scrubbed bash tool on first session start instead of at load, and resolve the pi agent dir in-process. Loading the extension no longer evaluates the whole pi-coding-agent module graph during startup (~1s).
