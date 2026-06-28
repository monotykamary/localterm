---
"@monotykamary/localterm": minor
---

Add a "Default directory" setting (Settings → Launch) that seeds the working directory for shells launched without an explicit path.

A bare launch — the PWA app icon, a fresh tab opened before any session connects, or a reloaded URL with no `?cwd=` — previously always spawned in the home directory, because the manifest pins `start_url: "/"` and the client only forwarded a cwd when the address bar carried one. The new setting persists to `localStorage` (key `localterm:default-cwd`) and is injected as a fallback in the WebSocket/new-tab URL builders, so the saved directory is used whenever no explicit `?cwd=` is present. The address-bar `?cwd=` and the live session's directory still take precedence, so in-session `cd`, reloads, and new tabs behave exactly as before; only param-less cold launches change.

Stays client-side to match every other SettingsMenu row (synchronous, cross-tab via the `storage` event). The server is unchanged: it still validates `?cwd=` as a directory and falls back to the home directory if the path is missing, invalid, or deleted, so a stale saved default degrades gracefully. Emptying the field clears the default and restores home-directory launches.
