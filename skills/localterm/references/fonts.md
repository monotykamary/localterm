# Fonts

Terminal fonts (the active font id + the user-entered custom family + the Nerd
Font / ligatures toggles) are server-managed state in `~/.localterm/fonts.json`,
so the `localterm font` CLI and every browser tab share one source of truth —
the same promotion themes got, replacing the per-browser `localStorage` the UI
used to keep. The daemon pushes the full font state over each open tab's
WebSocket as `{type:"fonts", activeFontId, customFontFamily, nerdFontEnabled,
ligaturesEnabled, initialized}` on every mutation (set / family / toggle /
migrate), so open terminals reflect a CLI or other-tab change instantly — the
browser applies the pushed state directly, no polling. The browser keeps a
`localStorage` cache for instant initial render and reconciles once on mount
(plus a one-time migrate of legacy `localStorage` fonts on first contact with an
uninitialized store).

## CLI

```bash
# List every selectable font (the built-ins + the "custom" entry) with the
# active one marked, plus the custom family + the Nerd Font / ligatures toggles.
localterm font list
#   ID                    NAME                      SOURCE
# * geist-mono            Geist Mono                built-in
#   custom                Custom…                   custom
#   jetbrains-mono        JetBrains Mono            built-in
#   ...

# Print the active font id + name, the custom family when active is "custom",
# and the toggle states.
localterm font get        # → jetbrains-mono  (JetBrains Mono)
#   nerd font: off   ligatures: off

# Set the active font (a built-in id, or "custom").
localterm font set jetbrains-mono
localterm font set custom

# Set the custom font family (a system-installed family like
# "JetBrainsMono Nerd Font Mono" or "MesloLGS NF" the OS resolves) AND activate
# the "custom" font in one step. A blank name clears the family back to the
# bundled default.
localterm font family "JetBrainsMono Nerd Font Mono"

# Toggle the bundled Nerd Font symbol layer (icons, powerline, box-drawing)
# over the selected font.
localterm font nerd-font on
localterm font nerd-font off

# Toggle ligature joining (Fira Code etc.) on the rendered terminal.
localterm font ligatures on
localterm font ligatures off
```

Tab-completion: `font set <TAB>` completes built-in ids + `custom`; `font
nerd-font` / `font ligatures` complete `on`/`off`; `font family <TAB>` falls back
to the shell's default (the family is a free-form string the OS resolves, so
there's no candidate list to offer).

## REST endpoints

```bash
BASE="http://127.0.0.1:$(cat ~/.localterm/server.port 2>/dev/null || echo 3417)/api"

# The full state in one read: active id + custom family + toggles + whether the
# store has ever been written (`initialized` — the migration gate).
curl -s "$BASE/fonts"
# → {"activeFontId":"jetbrains-mono","customFontFamily":"","nerdFontEnabled":true,"ligaturesEnabled":false,"initialized":true}

# Update any subset of the font settings (the client pushes only the field that
# changed). `activeFontId` is validated against the built-ins (incl. "custom").
curl -s -X PUT "$BASE/fonts" -H 'content-type: application/json' \
  -d '{"activeFontId":"custom","customFontFamily":"MesloLGS NF"}'
# → {"activeFontId":"custom","customFontFamily":"MesloLGS NF","nerdFontEnabled":false,"ligaturesEnabled":false,"initialized":true}

curl -s -X PUT "$BASE/fonts" -H 'content-type: application/json' \
  -d '{"nerdFontEnabled":true}'

# One-time migration of the browser's legacy localStorage font state. No-ops
# once the store is `initialized`; the browser calls it on first contact with
# an uninitialized store so an upgrade preserves the user's font selection +
# toggles.
curl -s -X POST "$BASE/fonts/migrate" -H 'content-type: application/json' \
  -d '{"activeFontId":"custom","customFontFamily":"MesloLGS NF","nerdFontEnabled":true,"ligaturesEnabled":false}'
```

### Error responses

- `PUT /fonts` → `400 {"error":"invalid_body"}` for a bad request shape (or an
  empty update with no fields); `404 {"error":"not_found"}` for an
  `activeFontId` that isn't a built-in or "custom" (a typo is rejected rather
  than silently falling back to the default family).
- `POST /fonts/migrate` → `400 {"error":"invalid_body"}` for a bad request
  shape (all four fields are required).

## The built-in catalog

The 11 bundled fonts (no runtime network fetch — the latin woff2 subset of the
selected font is fetched at runtime, so they work on an air-gapped or firewalled
host):

Geist Mono (default), JetBrains Mono, Fira Code, IBM Plex Mono, Source Code Pro,
Roboto Mono, DM Mono, Inconsolata, Space Mono, Ubuntu Mono, Anonymous Pro.

The `"custom"` pseudo-id is selectable like a built-in; the browser builds its
`TerminalFont` on demand from the user-entered family name (resolved through the
OS font stack — fontconfig on Linux, Font Book on macOS). The active id is
sanitized on load: a stale id (a hand-edited file, or a future removed built-in)
falls back to the default (Geist Mono) rather than rendering with an
unresolvable family.

## The active font

The active id resolves client-side:

- A built-in id → the matching catalog font (with its bundled CSS family).
- `"custom"` → a font built from the stored custom family name, with the
  bundled Nerd Font symbol face and the generic monospace fallback layered in;
  an empty family falls back to the bundled default family.
