# Light-theme rendering diagnostic

This harness separates two light-theme problems:

- glyph polarity: the patched alpha-mask renderer versus the pinned upstream WebGL renderer;
- palette contrast: each default/ANSI color against the theme background, with and without xterm's `minimumContrastRatio: 4.5` correction.

It reconstructs the upstream addon in memory by reversing the repository's pnpm patch, so the comparison uses the exact same pinned package version without downloading or vendoring another bundle.

## Visual comparison

```bash
pnpm --filter @monotykamary/localterm-harness-light-theme-rendering serve
```

Open <http://127.0.0.1:4819/>. Select a light theme to show the current alpha-mask WebGL renderer beside pinned upstream WebGL. Use the contrast-floor selector to switch both between the default `1` and `4.5`. Automated measurements still cover all three themes on every run.

Look at thin strokes (`il1|`), diagonals and curves (`MW@#%`), and ANSI white/bright colors. If the 4.5 floor changes upstream but not current WebGL, the alpha-mask color path is bypassing xterm's contrast correction.

## Automated report

With the server still running:

```bash
pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
```

The driver defaults to DPR 2, prints ink, contrast-correction, and live dark-to-light switch metrics, and writes `/tmp/localterm-light-theme-rendering.png`. A healthy result has no greater-than-5% ink increase, nonzero contrast-floor pixel changes in both renderers, and zero switched-versus-fresh pixel differences.

Use `DPR=1` to compare non-Retina rendering, `THEME=solarized-light` to select the screenshot theme, `CONTRAST_FLOOR=4.5` to render corrected colors, or `HEADLESS=0` to run Chrome visibly:

```bash
DPR=1 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
THEME=solarized-light pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
CONTRAST_FLOOR=4.5 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
HEADLESS=0 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
```
