---
"@monotykamary/localterm-server": minor
"@monotykamary/localterm": minor
---

Preview and open changed images in the diff viewer.

The diff viewer's "open file" affordance now handles images, and a changed image
renders inline in the diff pane instead of the generic "Binary file — no text
diff to show." notice.

- Selecting an image file (png/jpg/jpeg/gif/webp/avif/bmp/ico/svg) renders an
  inline `<img>` preview straight from the working tree, so a glance at the diff
  shows the actual pixels. A load failure (e.g. a deleted image whose file is
  gone) falls back to a notice rather than a lingering broken-image icon.
- The header's ExternalLink button — previously hidden for every binary — now
  opens image files in a new browser tab, where Chrome renders them natively;
  text files still open in neovim via the existing PTY-tab path. Non-image
  binaries keep the old behavior (no button).
- A new `GET /api/file?cwd=&path=` route on the daemon serves working-tree image
  bytes with a real `Content-Type` and `Content-Disposition: inline`. It is
  gated to image content types so it can never serve an arbitrary HTML/text file
  from the same origin (which would let a repo file XSS the terminal app). SVG
  responses carry a `default-src 'none'` CSP so an embedded `<script>` can't run
  even when the SVG is navigated to directly, and `cache-control: no-store`
  keeps the preview current after an in-place edit.
- The image allowlist (`isImagePath`) is shared between server and client via the
  `protocol` subpath, so the route and the viewer agree on what counts as an
  image.
- SVG is text (git reports `binary: false`), so SVGs keep their readable text
  diff AND gain the open-image button to view the rendered result; raster images
  are always binary, so they show the preview.
