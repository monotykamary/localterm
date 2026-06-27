---
"@monotykamary/localterm": minor
---

Add a QR session-transfer modal to the terminal toolbar for handing a live shell between devices. The toolbar's new-tab button (`+`) is replaced by a QR icon — the `Alt+T`/`⌘T` new-tab shortcut and the command-palette "Open new shell" entry still work via a kept-but-hidden anchor — that opens a modal with a Share/Ingest switcher.

Share renders a QR of the current tab's session URL (`<origin>/?sid=<id>`) for the localterm PWA on another device to scan and reattach to the same shell; a copy-link button mirrors the URL for manual sharing. Ingest opens the device camera, decodes another device's session QR with jsQR, extracts the `sid`, and switches this tab to that session via the existing session-switch path. Non-session QRs are ignored so scanning keeps hunting, and the camera stream stops the instant the modal closes or switches back to Share.

Dependencies: qrcode.react (QR rendering) and jsqr (camera-frame decoding), both browser-only.
