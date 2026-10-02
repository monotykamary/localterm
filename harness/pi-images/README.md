# Pi v1 fullscreen image regression

Run from the repository root after `bun install`:

```sh
bun run test:e2e:pi-images
```

Requires Chrome; set `LOCALTERM_CHROME_BIN` if it is not installed at the standard
macOS path. The probe launches its own headless Chrome profile and loopback HTTP
server. It never starts, restarts, or attaches to a LocalTerm daemon or the user's
browser. It is an on-demand browser tier, not part of the deterministic unit gate.

`frames.mjs` uses the workspace's real Pi v1 `TuiAltScreen` and `Image` components
to render a 24-image transcript. `page.mjs` replays those actual bytes through the
terminal app's resolved xterm and patched image-addon ESM entrypoints, including:

- initial display and multiple simultaneous images;
- scrolling up, down, and through a partially visible image;
- cached placement-only redraws without re-uploading image data;
- resize, forced redraw, and leaving/re-entering the alternate screen;
- DPR 1 and DPR 2, including the existing HiDPI/contain-fit addon patch.

Every expected image row is sampled from the real canvas. Opaque red/green pixels
(including interpolation between the two source bands) must remain visible; blank
rows, transparency, and missing-image checkerboards fail. The probe also asserts
that Pi actually emitted cached placements and cropped image commands.

To compare against an older extracted addon bundle, set `LOCALTERM_IMAGE_ADDON`
to its absolute `lib/addon-image.mjs` path. No installed dependencies are changed.

The deterministic `kitty-image-lifecycle.test.ts` tests both ESM and CommonJS
entrypoints for lowercase/uppercase deletion, placement IDs, tile lifetime,
buffer isolation, reset, and bounded retained payloads. Its bitmap mocks test
protocol ownership, not pixel rendering; the browser probe supplies that check.

The implementation follows the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/):
placement-only deletion retains uploaded data, text line erasure does not erase
graphics, and the normal/alternate buffers have separate image lifetimes.
