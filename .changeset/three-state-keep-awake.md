---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Give the keep-awake coffee control three modes: off, on, and automatic (the new default).

The coffee button is now a dropdown like the settings menu. **Automatic** keeps the system awake
only while a recognized program is running in a localterm session — `claude`, `codex`, `opencode`,
and `pi` are detected out of the box, and you can add your own commands on top. Detection matches the
full command line of processes running under each session's shell, so a CLI launched as
`node …/claude` still counts. Automatic carries a small corner badge to set it apart, and the coffee
icon tints to its warm accent only while keep-awake is actually engaged. The selected mode and your
custom commands are owned by the daemon, persisted to `~/.localterm/caffeinate.json`, and broadcast
to every tab so all open tabs stay in lockstep. macOS only, where `caffeinate` exists.
