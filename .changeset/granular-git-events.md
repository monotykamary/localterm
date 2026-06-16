---
"@monotykamary/localterm-server": major
"@monotykamary/localterm": major
---

Replace the umbrella `git-refs-change` and internal `git-dirty` session events with granular namespace and operation events (such as `git-head-change`, `git-commit`, `git-checkout`, `git-merge`, etc.). Event-based automations now use an `events` array and fire when any selected event occurs. The automation form uses a new Notion-like multi-select search for picking events.
