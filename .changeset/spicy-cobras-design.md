---
"@monotykamary/localterm-server": minor
"@monotykamary/localterm": minor
---

feat: automations — server-managed cron jobs that open a tab and run a command

The daemon now schedules cron-style automations (`~/.localterm/automations.json`,
managed via `/api/automations`). When a job is due the server opens a new browser
tab in the automation's directory, types the command into a fresh shell, and keeps
the tab open as a visual record; zsh/bash sessions report the command's exit code
back so the UI can show ran-and-succeeded. The terminal app gets an Automations
popover in the top-right toolbar (⌘J / Ctrl+J, plus a command palette entry) with
live status pushed over the WebSocket, and a `skills/localterm` SKILL.md teaches
LLM agents the API (installable with `npx skills add monotykamary/localterm`).
