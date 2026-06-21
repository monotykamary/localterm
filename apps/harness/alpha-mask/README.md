# alpha-mask bold repro harness

A standalone reproducer for the intermittent "every glyph renders semibold/bold"
bug in the patched `@xterm/addon-webgl` alpha-mask renderer
(`patches/@xterm__addon-webgl@0.20.0-beta.286.patch`). It loads the **real**
patched addon + `@xterm/xterm` + Geist Mono, spawns many terminals sharing the
module-level atlas cache (`acquireTextureAtlas` → global `e0`), and measures the
rendered glyph ink coverage from each terminal's WebGL canvas to classify the
weight as `~400 (normal)` / `~700 (bold)` / `heavier` / `lighter`.

## Why this shape

- The patched alpha-mask bundle is resolved through the terminal app's dependency graph
  (`createRequire` from `apps/terminal/package.json`), so pnpm's patched-package symlink
  is followed to the real file regardless of how the addon's `patch_hash` changes.
- The atlas cache is module-scoped, so every `Terminal` in one page shares a
  single atlas — mimicking in-app terminal tabs in one JS context.
- It captures per-tab: ink ratio, calibrated weight classification, char
  dimensions, dpr, and the `.xterm` root computed `font-weight` (a classic
  inherited-weight leak source).
- A **positive control** forces `fontWeight: "bold"` to prove the detector can
  see 700-weight rendering (it can — ratio 1.136 vs 400).

## Run

```bash
# terminal A: static server
pnpm --filter @monotykamary/localterm-harness-alpha-mask serve
# -> http://127.0.0.1:4817/

# terminal B: drive it headless via CDP and print the verdict
pnpm --filter @monotykamary/localterm-harness-alpha-mask drive
```

`HEADLESS=0 pnpm ... drive` launches a visible Chrome for eyeballing.
`CHROME_PATH=/path/to/chrome` overrides the browser (point it at the Dia binary
to run inside the real environment).

In the page, `auto-scan` runs: calibrate weights → reference terminal → positive
control → cold (no font preload / no `fonts.ready`) → warm → safe-repeat → heal
(clearTextureAtlas on a cold batch).

## Interpreting results

- `weight=~700 (bold)` on normal tabs = the renderer is drawing 700 for 400-keyed
  glyphs → atlas/option/font-config side.
- `weight=heavier(~NN%)` not matching 700, or `lighter` = fallback font or
  dimension/measure mismatch, not a weight-700 atlas bug.
- `dims:` line shows `charWidth`/`charHeight`/`rootFontWeight` — if
  `rootFontWeight` is not `400`, an ancestor sets a heavy weight.
- The `clearTextureAtlas` heal block shows whether eviction+rebuild recovers.

## Status on this machine

Headless Chrome with locally-served fonts does **not** reproduce the boldening
(Geist Mono resolves instantly, no real font race). The detector is validated
by the positive control. Run it in the Dia/browser environment where the bug
occurs so the `weight` column pinpoints the actual cause.
