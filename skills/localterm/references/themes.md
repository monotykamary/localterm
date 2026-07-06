# Themes

Terminal themes (the built-in catalog + user-imported custom themes + the active
selection) are server-managed state in `~/.localterm/themes.json`, so the
`localterm theme` CLI and every browser tab share one source of truth. The
browser keeps a `localStorage` cache for instant initial render (no flash of the
default) and reconciles against the server on mount + a slow poll, so a CLI
change reaches open tabs.

## CLI

```bash
# List every selectable theme (built-ins + imports) with the active one marked.
localterm theme list
#   ID                    NAME                      SOURCE
# * auto                  Auto (system)             built-in
#   vesper                Vesper                    built-in
#   dracula               Dracula                    built-in
#   ...
# * custom-abc123         Mine                       imported

# Print the active theme id + name.
localterm theme get        # → dracula  (Dracula)

# Import a theme file → stored as a custom theme. Prints the new id.
# Accepts JSON `{name, colors}` / a bare colors object, or an iTerm
# .itermcolors plist.
localterm theme import ~/themes/dracula.json
# → ✓ imported 'Dracula'
#     id: custom-lq3a2p
#     set it with: localterm theme set custom-lq3a2p
localterm theme import ~/themes/vesper.itermcolors

# Set the active theme (a built-in id, 'auto', or a custom id from `import`).
localterm theme set dracula
localterm theme set auto
localterm theme set custom-lq3a2p

# Delete an imported custom theme. Deleting the active custom theme resets the
# active id to the default (Vesper).
localterm theme delete custom-lq3a2p
```

Tab-completion: `theme set <TAB>` completes built-in ids + 'auto' + custom ids;
`theme delete <TAB>` completes custom ids only; `theme import <TAB>` falls back to
filename completion.

## REST endpoints

```bash
BASE="http://127.0.0.1:$(cat ~/.localterm/server.port 2>/dev/null || echo 3417)/api"

# The full state in one read: the active id + the custom library + whether the
# store has ever been written (`initialized` — the migration gate).
curl -s "$BASE/themes"
# → {"activeThemeId":"dracula","customThemes":[{...}],"initialized":true}

# Import from raw file text + filename (the daemon parses — one parser shared
# with the browser upload and the CLI). 201 returns the stored theme with its
# server-minted id.
curl -s -X POST "$BASE/themes/import" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg t "$(cat ~/themes/dracula.json)" --arg f 'dracula.json' '{text:$t,filename:$f}')"
# → 201 {"theme":{"id":"custom-…","name":"Dracula","source":"imported","colors":{...}}}

# Set the active theme (a built-in id, 'auto', or a custom id).
curl -s -X PUT "$BASE/themes/active" -H 'content-type: application/json' \
  -d '{"id":"dracula"}'
# → {"activeThemeId":"dracula"}

# Delete a custom theme. Returns the new active id (the default if the active
# custom theme was deleted).
curl -s -X DELETE "$BASE/themes/<id>"
# → {"activeThemeId":"vesper"}

# One-time migration of the browser's legacy localStorage themes. No-ops once
# the store is `initialized`; the browser calls it on first contact with an
# uninitialized store so an upgrade preserves the user's imported themes +
# active selection (ids preserved).
curl -s -X POST "$BASE/themes/migrate" -H 'content-type: application/json' \
  -d '{"activeThemeId":"dracula","customThemes":[{...}]}'
```

### Error responses

- `POST /themes/import` → `400 {"error":"invalid_body"}` (bad request shape) or
  `400 {"error":"invalid_theme","message":"…"}` (unparseable/empty file); `409
{"error":"capacity"}` when the custom-theme cap (`MAX_CUSTOM_THEMES`) is reached.
- `PUT /themes/active` → `400 {"error":"invalid_body"}` or `404 {"error":"not_found"}`
  for an id that isn't a built-in, `auto`, or a stored custom theme (a typo is
  rejected rather than silently falling back to the default).
- `DELETE /themes/:id` → `404 {"error":"not_found"}` for an unknown custom id.

## Import formats

The daemon parses the import text (one parser, shared by the browser upload and
the CLI):

- **JSON `{name, colors}`** — the `TerminalTheme` shape minus the generated
  `id`/`source`. `colors` is the xterm `ITheme` (any subset of the color keys as
  `#rrggbb` strings; the parser normalizes `#rgb` and drops alpha from
  `#rrggbbaa`, and omits non-hex fields so xterm keeps its per-field defaults).
- **Bare colors object** — `{background:"#…", foreground:"#…", …}` (the xterm
  `ITheme` directly); the name is derived from the filename.
- **iTerm `.itermcolors`** — an Apple plist XML; the parser maps `Background
Color`/`Ansi 0 Color`/… components (`Red/Green/Blue Component` 0–1 floats) to
  the ITheme keys. The name is derived from the filename.

## The active theme

The active id resolves client-side:

- A built-in id → the matching catalog theme.
- `auto` → the dark default (Vesper) or the light default (GitHub Light) from
  the host's `prefers-color-scheme` (a desktop light/dark switch re-resolves
  live, no reload).
- A custom id → the matching stored custom theme; an id that no longer resolves
  (a deleted custom) falls back to the default.
