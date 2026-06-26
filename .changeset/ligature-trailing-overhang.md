---
"@monotykamary/localterm": patch
---

Fix the trailing-glyph clip in joined ligature runs. A terminal font's last glyph in a joined run can overhang its cell advance by more than the renderer's flat 3-device-px trailing budget (notably Fira Code's capital F arm in `0xDEADBEEF`, `0xCAFE`), so the atlas sized both the temp raster and the ink-bounding scan short of the true ink and the tail was cut off. The WebGL addon patch now adds a `deviceCellWidth`-scaled trailing overhang budget so the canvas and scan capture the full ink at any font size, while the bounding-box trim keeps the textured quad tight.
