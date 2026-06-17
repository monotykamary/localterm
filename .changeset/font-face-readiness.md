---
"@monotykamary/localterm": patch
---

Fix intermittent bold rendering of terminal text after reload. awaitFontReady
now polls the real FontFace.status until "loaded" before resolving, so the
WebGL glyph atlas is no longer cleared against an unloaded Geist Mono face
(which re-rasterized regular text at a fallback weight). Also ship the missing
@fontsource/geist-mono/700.css so bold text renders at 700 instead of 600.
