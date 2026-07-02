---
"@monotykamary/localterm-server": minor
"@monotykamary/localterm-terminal": minor
---

The Settings → Automation browser section is now the first section, and the settings gear shows an amber badge while CDP is known-disconnected.

Added an "Inspect" button next to Connect that opens `chrome://inspect` in the user's browser. This is the bootstrap path for users who haven't enabled remote debugging yet — they open the inspect page to toggle "Discover network targets" — so it deliberately does **not** use CDP (CDP isn't available to those users). `chrome://` URLs can't be navigated to from a web page and have no registered OS URL-scheme handler, so the button hits a new `POST /api/cdp/open-inspect` daemon route. On macOS the daemon runs an AppleScript that detects the running Chromium app dynamically (preferring the frontmost one — the browser the user is viewing localterm in — falling back to the first running candidate from the existing browser list) and sends it a `open location "chrome://inspect/#remote-debugging"` event, which reuses the running profile and avoids the profile picker. No browser is assumed or hardcoded; elsewhere the OS opener is used as a best-effort fallback.
