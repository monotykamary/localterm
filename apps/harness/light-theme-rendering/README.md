# Light-theme rendering diagnostic

This harness verifies four related light-theme behaviors:

- normal WebGL glyph shape and fullness against xterm's native Canvas renderer;
- browser compositing, including bright edge halos caused by a translucent WebGL framebuffer;
- readable SGR faint text on light backgrounds;
- inverse-cell, ANSI contrast-correction, emoji, and live theme-switch safety.

Canvas and DOM are diagnostic references only. LocalTerm continues to use the WebGL renderer in production.

The server reconstructs the upstream addon in memory by reversing the repository's pnpm patch. Comparisons therefore use the exact same pinned package version without downloading or vendoring another bundle.

## Why Canvas reconstruction

A transparent 2D canvas exposes antialiasing coverage that differs from the opaque text raster produced by Canvas and DOM on macOS. Applying a contrast or gamma curve to that transparent coverage cannot reproduce the missing stem geometry consistently across fonts.

LocalTerm instead rasterizes monochrome text on an opaque 2D canvas using the theme's default foreground and background, then projects each composited RGB pixel onto that color axis to recover a reusable scalar alpha mask. The WebGL shader can still apply each cell's real foreground color, while the mask retains the platform rasterizer's Canvas-quality shape and fullness. Colored emoji stay on a separate transparent RGBA path.

Fractional glyph coverage also requires separate RGB and alpha blend factors. Keeping the destination alpha opaque prevents the browser compositor from adding a light background twice and producing bright, fuzzy edge pixels.

## Visual comparison

```bash
pnpm --filter @monotykamary/localterm-harness-light-theme-rendering serve
```

Open <http://127.0.0.1:4819/>. Select any bundled font and light theme to compare current WebGL, xterm Canvas, and xterm DOM. The contrast-floor selector changes the visible cards between disabled `1` and LocalTerm's default `4.5`; automated measurements always exercise both settings where relevant.

Inspect thin strokes (`il1|`), dense stems (`MW@#%`), curves and diagonals, box drawing, blocks, Powerline symbols, wide fallbacks, colored emoji, Pi-style muted text, SGR faint text, and inverse cells. Normal WebGL text should have the same body as Canvas and DOM without pale pixels around its edges.

## Automated report

With the server running:

```bash
pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
```

The driver uses Geist Mono at 13px, line height 1.2, and DPR 2 by default. It measures all four light themes internally, refreshes displayed terminals before capture, and captures each renderer's native device pixels through CDP without resampling. It writes:

- `/tmp/localterm-light-theme-rendering.png`;
- `/tmp/localterm-light-theme-rendering-detail.png`;
- renderer-only `-patched.png`, `-canvas.png`, and `-dom.png` files.

The command exits nonzero when a validation gate fails. Normal WebGL coverage must stay close to Canvas: at most 3% ink delta, 1.5% visible-support delta, 2.5 percentage points of hard-pixel delta, 4 points of fuzzy-pixel delta, 2 points of mean-coverage delta, 3.5% visible coverage error, 7% changed half-coverage mask, and 4% half-coverage area delta. The WebGL framebuffer must contain no translucent pixels.

The independent browser screenshots allow up to 5% normal ink, visible-support, and coverage-distribution deltas versus Canvas, a mean channel difference of 3, and 12% changed pixels. These screenshot checks catch browser-compositor errors that `readPixels` cannot see.

SGR faint text must retain at least 4.5:1 core contrast, 57% mean visible coverage, and 45% ink gain over pinned upstream WebGL. Inverse ink stays within 6% of Canvas, normal contrast-adjustment pixel counts stay within 7% of upstream, and a live dark-to-light switch must exactly match a fresh light terminal.

Use environment variables to probe another configuration:

```bash
FONT=inconsolata pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
DPR=1 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
THEME=tokyo-night-day pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
CONTRAST_FLOOR=4.5 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
HEADLESS=0 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
```
