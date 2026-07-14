---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Paste an image from the phone (or desktop clipboard) onto the terminal.

The PWA's input surface was strictly text: `terminal.paste(text)` into xterm's
off-screen textarea, with no `paste`/`drop` listener and no notion of a binary
blob, so a pasted screenshot or photo was silently dropped. The WebSocket
`input` message is a capped text string written straight to the PTY, and the
`@xterm/addon-image`/`-clipboard` addons are output/OSC-52 only — neither
touches input.

A new `POST /api/upload-image` route accepts a multipart image Blob (auth-gated
like the rest of `/api`, gated to a raster image-type allowlist that excludes
SVG, capped at 32 MB, with a cwd-containment guard), writes it into the
session's cwd as `pasted-<ts>-<id>.<ext>`, and returns the absolute path. The
client then pastes that path (shell-quoted) into the prompt via the existing
bracketed-paste pipeline, so it lands without executing and the user can pipe
it to a viewer, hand it to an agent, etc.

Entry points: an attach button in the action toolbar (phone/tablet) and an
image key on the on-screen keyboard both open the system photo/file picker —
the reliable cross-platform path, since iOS Safari blocks clipboard image
reads and mobile paste into the hidden textarea is unreliable. On desktop,
Ctrl/Cmd+V and drag-drop onto the terminal are handled by capture-phase
`paste`/`drop` listeners that intercept an image paste before xterm reads the
clipboard's empty text representation (text pastes fall through untouched). A
transient toast reports the upload and any failure.

The Android share-sheet `share_target` (manifest + service-worker stash +
cold-start cwd handoff) is intentionally deferred to a focused follow-up; the
attach button already covers the "get an image from my phone onto the terminal"
intent on both Android and iPhone.
