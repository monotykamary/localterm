---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Revert `@fontsource/geist-mono` to 5.2.7 and lock it with a pnpm workspace override.

A blanket `chore(deps): update all dependencies to latest` had bumped the exact
`5.2.7` pin back to `5.2.8`, which packages Geist 1.7.0. Geist 1.7.0 collapses
every coding ligature (`:=`, `=>`, `!=`, `==`, `->`, `-->`, `>=`, `<=`) to a
single cell under the `liga` feature; xterm.js's fixed-cell ligature model then
left-clips the ligature (the colon in `:=` vanishes) and shifts trailing glyphs
one cell left. 5.2.7 (Geist 1.401) emits each ligature as a multi-cell
substitution so xterm renders correctly.

The exact package.json pin alone was not enough — a wholesale `pnpm update -L`
rewrites the specifier. A new `overrides` entry in `pnpm-workspace.yaml` forces
`@fontsource/geist-mono` to `5.2.7` workspace-wide, so the lockfile resolves to
5.2.7 even if a future update rewrites the consumer range. `apps/terminal` stays
pinned exactly to `5.2.7` as well.

Upstream Geist 1.7.0 ligature regression: vercel/geist-font#201, #231.
