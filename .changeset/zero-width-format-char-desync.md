---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix garbled terminal output and a mis-parked block cursor when a TUI app (e.g. Claude Code) finishes a task. The xterm unicode provider counted invisible format characters (zero-width space, BOM, soft hyphen, bidi marks, word joiners, Arabic prepended signs, Unicode tags) as 1 column while the app's width function counts them 0, so a single such character in an exactly-full line wrapped the row a column early and permanently desynced the app's relative-cursor diff renderer. These are now zeroed (joined into the preceding cell so they consume no column), and the inverse class of Unicode 15.1 wide characters the bundled data under-counts is widened to 2.
