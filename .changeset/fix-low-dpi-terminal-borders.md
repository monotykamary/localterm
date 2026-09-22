---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix thin terminal borders disappearing on low-DPI displays by scanning cropped glyph images with their own dimensions instead of the reusable scratch canvas's dimensions.
