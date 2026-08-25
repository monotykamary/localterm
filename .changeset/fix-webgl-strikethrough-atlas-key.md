---
"@monotykamary/localterm": patch
---

Fix WebGL glyph atlas poisoning by strikethrough, overline, and invisible cell variants. The atlas cache key only distinguished bold/italic, so whichever variant rasterized a character first was served for every later occurrence of the other: plain text could grow a baked strike line, or struck text could lose it, until atlas eviction. The key now covers every attribute bit baked into cached glyphs; colors still resolve per vertex. Validated by the light-theme harness (all gates unchanged) and a new struck/plain order probe that fails on the old bundle and passes on the fixed one.
