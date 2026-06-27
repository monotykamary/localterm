---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": patch
---

Make localterm a fully installable PWA with a maskable icon and an offline service worker.

The manifest previously held a single data-URI SVG icon and no service worker, so "Add to Home Screen" produced a Chrome-badged shortcut rather than an installable app. The manifest now references file-based icons — an SVG plus 192/512 PNGs declared `purpose: "any maskable"` — generated from a single `icon.svg` source via `pnpm generate:icons` (sharp). The full-bleed `#f4f4f5` background with a centered emerald `>_` sits inside the maskable safe zone with ~2.4 units of margin, so circular/squircle Android launchers apply their own shape and drop the Chrome badge, and iOS gets a clean `apple-touch-icon`.

A build-time service worker (`scripts/generate-sw.mjs` from `sw-template.js`, run as the last `build` step) precaches the app shell, all font subsets, the icons, and the manifest under a content-hashed version, serves navigations network-first with the cached shell as the offline fallback, bypasses `/api` and `/ws`, and purges stale caches on activation. Registered from the terminal only in production builds.

The manifest gains `id`, `lang`, `dir`, `categories`, and `launch_handler` (reuse existing window on relaunch), and `index.html` gains `apple-touch-icon`, `mobile-web-app-capable`, `apple-mobile-web-app-title`, and `application-name`. The app root is padded with `env(safe-area-inset-*)` so the terminal and toolbar clear phone notches and the home-indicator bar in standalone mode.

Server: the static resolver now serves `.webmanifest` as `application/manifest+json` (it was `application/octet-stream`, which strict browsers reject) and sends `cache-control: no-cache` for `/sw.js` and `/manifest.webmanifest` so a new build is detected promptly.
