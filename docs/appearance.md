# Appearance (themes & fonts)

localterm ships 19 built-in themes (16 dark + 3 light) and 11 bundled fonts,
all of which work fully offline. You can also import your own theme (JSON or an
iTerm `.itermcolors` file) and use any system-installed font family.

## Themes

### Built-in themes

Open **Settings → Theme** to pick from the built-ins:

- **Dark:** Vesper (default), Ayu Mirage, Catppuccin Frappe/Macchiato/Mocha, Dracula, GitHub Dark, Gruvbox Dark (Medium), Monokai, Night Owl, Nord, One Dark Pro, Solarized Dark, SynthWave '84, Tokyo Night, Tokyo Night Storm.
- **Light:** GitHub Light, Solarized Light, Catppuccin Latte.
- **Auto (system):** resolves to the dark default (Vesper) or the light default (GitHub Light) from your desktop's color-scheme, and re-resolves live when you switch — so a Linux GTK light/dark toggle flips the terminal without a reload.

### Importing a theme

**Settings → Theme → Import theme…** opens a file picker that accepts:

- a `.json` theme file (see [Creating a theme](#creating-a-theme) below), or
- an iTerm **`.itermcolors`** file (the common share format — export one from iTerm2, or grab one from a theme repo).

Imported themes are stored on the daemon in `~/.localterm/themes.json` and shared
with the `localterm theme` CLI (see [CLI reference](cli.md#theme--terminal-themes)),
listed after the built-ins in the picker, and deletable (a delete on the active
theme falls back to the default). A malformed file shows an error message instead
of silently doing nothing. A theme set or imported from the CLI (or another
browser tab) updates every open terminal instantly — the daemon pushes the
change over each tab's WebSocket, so no reload or polling is needed.

If you imported themes in an earlier version (when they were kept per-browser in
`localStorage`), they're moved to the daemon's store on your next launch — your
imported themes and active selection carry over (ids preserved), so an upgrade
never loses them.

### From the CLI

You can also import and switch themes from the terminal, which is handy for
scripting or a headless host with no browser open:

```bash
localterm theme import ~/themes/dracula.json   # prints the new custom id
localterm theme set custom-lq3a2p               # or a built-in like `dracula`, or `auto`
localterm theme list                             # built-ins + imports, active one marked
localterm theme delete custom-lq3a2p
```

`theme import` accepts the same JSON and `.itermcolors` formats as the browser
upload (below).

#### iTerm `.itermcolors`

The iTerm plist is an XML file of `<key>`/`<dict>` pairs. localterm maps the
0–1 component reals to `#rrggbb` hex:

| iTerm key                        | localterm field                                       |
| -------------------------------- | ----------------------------------------------------- |
| `Background Color`               | background                                            |
| `Foreground Color`               | foreground                                            |
| `Cursor Color`                   | cursor                                                |
| `Cursor Text Color`              | cursorAccent                                          |
| `Selection Color`                | selectionBackground                                   |
| `Selected Text Color`            | selectionForeground                                   |
| `Ansi 0 Color` … `Ansi 7 Color`  | black, red, green, yellow, blue, magenta, cyan, white |
| `Ansi 8 Color` … `Ansi 15 Color` | brightBlack, brightRed, … brightWhite                 |

Any color iTerm doesn't define is omitted, and xterm falls back to its
per-field default for that slot.

### Creating a theme

A theme is a JSON object with a `name` and a `colors` map of
[ANSI color slots](https://xtermjs.org/docs/api/terminal/interfaces/itheme/)
to `#rrggbb` hex strings. Save it as `my-theme.json` and import it:

```json
{
  "name": "My Theme",
  "colors": {
    "background": "#1a1b26",
    "foreground": "#a9b1d6",
    "cursor": "#c0caf5",
    "cursorAccent": "#1a1b26",
    "selectionBackground": "#33467c",
    "selectionForeground": "#c0caf5",
    "black": "#32344a",
    "red": "#f7768e",
    "green": "#9ece6a",
    "yellow": "#e0af68",
    "blue": "#7aa2f7",
    "magenta": "#bb9af7",
    "cyan": "#7dcfff",
    "white": "#a9b1d6",
    "brightBlack": "#444b6a",
    "brightRed": "#ff7a93",
    "brightGreen": "#b9f27c",
    "brightYellow": "#ff9e64",
    "brightBlue": "#7daeff",
    "brightMagenta": "#bb9af7",
    "brightCyan": "#0db9d7",
    "brightWhite": "#acb0d0"
  }
}
```

The full set of color slots:

| Slot           | Slot                  | Slot                  |
| -------------- | --------------------- | --------------------- |
| `background`   | `foreground`          | `cursor`              |
| `cursorAccent` | `selectionBackground` | `selectionForeground` |
| `black`        | `red`                 | `green`               |
| `yellow`       | `blue`                | `magenta`             |
| `cyan`         | `white`               | `brightBlack`         |
| `brightRed`    | `brightGreen`         | `brightYellow`        |
| `brightBlue`   | `brightMagenta`       | `brightCyan`          |
| `brightWhite`  |                       |                       |

Notes on color values:

- `#rrggbb` is the canonical form. `#rgb` is expanded (`#abc` → `#aabbcc`), and
  `#rrggbbaa` is accepted with the alpha dropped (terminal colors are opaque).
- Any non-hex value is omitted so xterm keeps its default for that slot — you
  don't have to specify every field. A theme with just `background` and
  `foreground` is valid.
- `name` is optional; if omitted, the file name (without extension) is used.
- The `extendedAnsi` palette (colors 16–255) is generated automatically from
  your 16 ANSI colors — don't include it.

You can also import a **bare colors object** (no `name`/`colors` wrapper) — the
xterm `ITheme` shape directly:

```json
{
  "background": "#1a1b26",
  "foreground": "#a9b1d6",
  "green": "#9ece6a"
}
```

## Fonts

### Bundled fonts

All 11 fonts are bundled as static assets (no network fetch), so they work on an
air-gapped or firewalled host:

Geist Mono (default), JetBrains Mono, Fira Code, IBM Plex Mono, Source Code Pro,
Roboto Mono, DM Mono, Inconsolata, Space Mono, Ubuntu Mono, Anonymous Pro.

Each is bundled at 400 (regular) and 700 (bold) weights, **except DM Mono**,
which tops out at 500 (no 700 weight exists) — its 500 is used for the bold face.

### Nerd Font symbols

Toggle **Nerd Font symbols** in Settings to layer the bundled Nerd Font symbol
glyphs (icons, powerline, box-drawing) over the selected font. The symbol glyphs
are bundled, so this works offline even when the selected font isn't itself a
Nerd Font.

### Custom font family

**Settings → Font → Custom…** lets you type a font family installed on the host
— most useful for a system-installed Nerd Font such as
`JetBrainsMono Nerd Font Mono` or `MesloLGS NF`, which the browser resolves
through the OS font stack (fontconfig on Linux, Font Book on macOS). A blank
field falls back to the bundled default. The family is stored in `localStorage`
and applied exactly like a built-in font, with the Nerd Font symbols layered on
top when that toggle is on.
