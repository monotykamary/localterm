---
"@monotykamary/localterm-terminal": patch
---

Replace the vendored alpha-mask `@xterm/addon-webgl` minified bundle with a
pnpm `patchedDependencies` patch. Runtime behavior is byte-identical to the
previous vendored bundle (verified by diffing the patched lib against the old
committed artifact); the alpha-mask change set now lives in
`patches/@xterm__addon-webgl@0.20.0-beta.286.patch` and is validated by pnpm at
install time, so upstream releases that break the patch fail loudly at
`pnpm install` instead of silently rotting as a hand-vendored copy.

Removes the broken string-transform vendor script (`scripts/vendor-webgl-addon.mjs`,
whose cache-key and shader patterns no longer matched the installed addon), the
`vendor:webgl` script entry, the committed minified bundle and its `.d.mts`
type shim, and restores the normal `@xterm/addon-webgl` package import.
