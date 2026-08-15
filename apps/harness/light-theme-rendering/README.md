# Theme rendering diagnostic

This harness verifies WebGL text rendering across both terminal polarities:

- normal glyph shape and fullness against xterm's native Canvas renderer;
- inverse dark-on-light and light-on-dark cells against matching Canvas raster polarity;
- browser compositing, including bright edge halos caused by a translucent WebGL framebuffer;
- readable SGR faint text on light backgrounds and Canvas-matched faint text on dark backgrounds;
- ANSI contrast correction, colored emoji, and live opposite-polarity theme switching.

Canvas and DOM are diagnostic references only. LocalTerm continues to use the WebGL renderer in production.

The server reconstructs the upstream addon in memory by reversing the repository's pnpm patch. Comparisons therefore use the exact same pinned package version without downloading or vendoring another bundle.

## Why Canvas reconstruction

A transparent 2D canvas exposes antialiasing coverage that differs from the opaque text raster produced by Canvas and DOM on macOS. Applying a contrast or gamma curve to that transparent coverage cannot reproduce the missing stem geometry consistently across fonts.

LocalTerm instead rasterizes monochrome text on an opaque 2D canvas using canonical theme colors, then projects each composited RGB pixel onto that color axis to recover a reusable scalar alpha mask. The WebGL shader can still apply each cell's real foreground color, while the mask retains the platform rasterizer's Canvas-quality shape and fullness. Inverse cache entries swap the canonical colors so their raster polarity also matches Canvas. Colored emoji stay on a separate transparent RGBA path.

Fractional glyph coverage requires separate RGB and alpha blend factors. Keeping the destination alpha opaque prevents the browser compositor from adding the background twice and producing bright, fuzzy edge pixels.

The reconstruction runs only when a glyph misses the atlas cache. It reads the calculated glyph raster bounds rather than the larger reusable scratch canvas and clears exact background pixels through a packed fast path. Cached frame rendering does not execute this code.

## Visual comparison

```bash
pnpm --filter @monotykamary/localterm-harness-light-theme-rendering serve
```

Open <http://127.0.0.1:4819/>. Select any built-in theme and bundled font to compare current WebGL, xterm Canvas, and xterm DOM. Selecting a light theme measures the four light palettes; selecting a dark theme measures all 16 dark palettes. The contrast-floor selector changes the visible cards between disabled `1` and `4.5`; automated measurements use LocalTerm's production value for each polarity.

Inspect thin strokes (`il1|`), dense stems (`MW@#%`), curves and diagonals, box drawing, blocks, Powerline symbols, wide fallbacks, colored emoji, Pi-style muted text, SGR faint text, and inverse cells. WebGL should have the same body as Canvas and DOM without pale pixels around its edges.

## Automated report

With the server running:

```bash
pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
```

The driver uses Geist Mono at 13px, line height 1.2, and DPR 2 by default. It refreshes displayed terminals before capture and captures each renderer's native device pixels through CDP without resampling. It writes:

- `/tmp/localterm-light-theme-rendering.png`;
- `/tmp/localterm-light-theme-rendering-detail.png`;
- renderer-only `-patched.png`, `-canvas.png`, and `-dom.png` files.

The command exits nonzero when a validation gate fails. Normal WebGL coverage must stay close to Canvas: at most 3% ink delta, 1.5% visible-support delta, 2.5 percentage points of hard-pixel delta, 4.1 points of fuzzy-pixel delta, 2 points of mean-coverage delta, 3.5% visible coverage error, 7% changed half-coverage mask, and 5.5% half-coverage area delta. The WebGL framebuffer must contain no translucent pixels.

The independent browser screenshots allow up to 5% normal ink, visible-support, and coverage-distribution deltas versus Canvas, a mean channel difference of 3, and 12% changed pixels. These checks catch browser-compositor errors that `readPixels` cannot see.

On light themes, SGR faint text must retain at least 4.5:1 core contrast, 57% mean visible coverage, and 45% ink gain over pinned upstream WebGL. On dark themes, faint text must stay within 3.5% ink, 1.5% visible support, 2 points of mean coverage, and 3.5% visible coverage error versus Canvas. Inverse ink stays within 1% of Canvas, normal contrast-adjustment pixel counts stay within 9% of upstream, and a live opposite-polarity switch must exactly match a fresh terminal.

Use environment variables to probe another configuration or explicit theme set:

```bash
FONT=inconsolata pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
DPR=1 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
THEME=vesper pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
THEME=vesper THEMES=vesper,tokyo-night,nord,solarized-dark pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
CONTRAST_FLOOR=4.5 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
HEADLESS=0 pnpm --filter @monotykamary/localterm-harness-light-theme-rendering drive
```
