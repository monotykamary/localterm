---
"@monotykamary/localterm": patch
---

fix: stop stale spinner/status lines when output contains non-Latin combining marks

Claude Code measures text with `Bun.stringWidth`, which counts most non-Latin combining marks (Cyrillic, Hebrew points, Arabic harakat, Indic, CJK voicing, …) as a spacing column instead of zero-width. The terminal joined them onto the base, so any line containing one drifted Claude's relative-cursor math by a column and left stale lines behind — e.g. a frozen spinner frame — until a resize forced a full repaint. The width provider now mirrors `Bun.stringWidth` for those marks, but only in the normal screen buffer where Claude runs; full-screen TUIs (vim, less, tmux) in the alternate buffer keep correct combining-mark rendering.
