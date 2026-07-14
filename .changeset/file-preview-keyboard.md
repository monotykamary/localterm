---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Preview repository files directly from automation logs and make macOS-style terminal editing shortcuts portable across shells and TUIs.

Backtick-wrapped relative file paths in automation output are now clickable. Images use the existing guarded asset route, while text files open in a new preview modal backed by a cwd-contained `/api/file/content` endpoint with a 1 MB limit and binary-file rejection.

Physical xterm input and the on-screen keyboard now share readline/pi-compatible editing sequences: Option or Control plus Left/Right moves by word, Command plus arrows moves to line boundaries, and Command plus Backspace deletes to the beginning of the line. Modifier-arrow input no longer leaks unbound xterm CSI tails such as `;3D` into default macOS bash prompts.
