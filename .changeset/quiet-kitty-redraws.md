---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
"@monotykamary/pi-localterm": minor
---

Fix disappearing and fragmented Pi v1 fullscreen images in LocalTerm. Preserve Kitty uploads across placement-only redraws, retain image tiles through line clears, isolate screen-buffer state, and bound retained payloads. Include both patched addon entrypoints and real Pi fullscreen browser regression coverage.

Update pi-localterm to target Pi v1 and use its documented image/link capability overrides instead of spoofing Kitty identity, while preserving explicit user settings. Older Pi versions should remain on pi-localterm 0.4.x. The renderer fix requires updating LocalTerm's terminal UI as well as the extension.
