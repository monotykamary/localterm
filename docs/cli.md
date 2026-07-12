# CLI reference

Every `localterm` command and flag. The daemon writes its state to
`~/.localterm/` (PID, port, server log at `~/.localterm/server.log`).

```bash
localterm start [-p 3417] [-H 127.0.0.1] [--open]   # daemonizes by default
localterm stop
localterm status
localterm restart
localterm install [-p 3417] [-H 127.0.0.1]  # auto-start (launchd on macOS, systemd user unit on Linux)
localterm uninstall                              # remove auto-start service
localterm completions <bash|zsh|fish> [--install|--uninstall]  # print/install/uninstall shell completions
```

## config

```bash
localterm config identity <provider> [options]   # configure an identity provider (see Identity & SSO)
```

## exec & session — the tmux-parity surface

`exec` and the `localterm session` group drive PTYs headlessly over the CLI and
the matching REST API. REST-created sessions are **pinned** by default (exempt
from the idle reap) so an agent's shell survives between calls; `exec` is
synchronous — one call returns a command's captured output and exit code, the
LLM-ergonomic upgrade over tmux's fire-and-forget `send-keys`.

```bash
localterm exec "<command>" [--cwd <path>] [--shell <path>] [--timeout 60] [--json]  # one-shot: run, capture, exit with its code
localterm session ls [--json]                    # list live PTYs
localterm session new [--cwd <path>] [--shell <path>] [--cmd <c>] [--name <t>] [--no-pin] [--json]  # spawn a detached shell
localterm session attach <id>                    # open a browser tab onto a shell
localterm session exec <id> "<cmd>" [--timeout 60] [--json]  # run in a persistent session
localterm session send-keys <id> '<keys>'        # raw input (\n=Enter, \x03=Ctrl-C)
localterm session press <id> <keys...>           # named keys: F2, Ctrl-C, Escape : w q Enter
localterm session capture <id> [--lines 200] [--json]  # rendered screen (tmux capture-pane -p)
localterm session capture <id> --png -o shot.png # screenshot via the browser (CDP)
localterm session wait <id> --text "done" [--timeout 10] [--json]  # block until the pane matches
localterm session mouse click <id> --on-text OK | --col N --row N  # drive mouse-first TUIs
localterm session mouse drag|move|scroll <id> …   # drag/move/scroll gestures
localterm session state <id>                     # mouse tracking + viewport size
localterm session resize <id> --cols 120 --rows 40
localterm session rename <id> <name>
localterm session pin <id> | unpin <id>           # toggle idle-reap exemption
localterm session kill <id>
```

`press` sends named keys, `wait` blocks until the pane matches, `capture --png`
screenshots the terminal via the daemon's existing CDP socket (the browser is
the rasterizer — no new dep), and `mouse` drives mouse-first TUIs (NetHack,
dialog installers, `mc`) through the viewer's xterm.js with an SGR fallback for
true headless.

## secret & process — Keychain-backed secrets

```bash
localterm secret list                            # per-program secrets (names + policy; never values)
localterm secret get <name>                       # print a value (resolved from Keychain, not the daemon)
localterm secret set <name> -e <VAR> [-p a,b] [-v <value>|-]  # -v - reads stdin
localterm secret delete <name>
localterm process list                            # binaries wrapped with a secret-injecting PATH shim
localterm process set <name>                       # set the secrets a binary receives (generates its shim)
localterm process delete <name>                   # delete a process and its shim
```

See [the skills reference](../skills/localterm/references/secrets-sessions.md)
for the security model and the PATH-shim injection mechanism.

## theme — terminal themes

```bash
localterm theme list                       # built-ins + imports, active one marked
localterm theme get                        # print the active theme id + name
localterm theme import <file>              # JSON {name,colors}/bare colors, or iTerm .itermcolors → stored custom
localterm theme set <id>                   # a built-in id, 'auto', or a custom id from `import`
localterm theme delete <id>                # delete an imported custom (resets active to the default)
```

Themes (built-ins + imported customs + the active selection) are server-managed
in `~/.localterm/themes.json` and shared with the browser UI — a theme imported or
set from the CLI shows up in every browser tab, and one imported in a tab is
deletable from the CLI. `import` accepts the same formats as the browser upload
(see [Appearance](appearance.md)); the daemon parses the file. Tab-completion:
`theme set` completes built-ins + `auto` + customs; `theme delete` completes
customs.

## font — terminal fonts

```bash
localterm font list                       # built-ins + the custom entry, active one marked
localterm font get                        # print the active font id + name (+ custom family, toggles)
localterm font set <id>                   # a built-in id, or 'custom'
localterm font family <name>              # set the custom family (a system font) + activate it
localterm font nerd-font <on|off>          # toggle the Nerd Font symbol layer
localterm font ligatures <on|off>          # toggle ligature joining (Fira Code etc.)
```

The active font id, the custom font family, and the Nerd Font / ligatures
toggles are server-managed in `~/.localterm/fonts.json` and shared with the
browser UI — a font set or a custom family entered from the CLI shows up in
every browser tab. `font family <name>` sets the custom family **and**
activates the `custom` font in one step; a blank name clears the family back
to the bundled default. Tab-completion: `font set` completes built-ins +
`custom`; `font nerd-font` / `font ligatures` complete `on`/`off`.

## Related

- [Appearance](appearance.md) — themes (built-ins, importing, creating) and fonts.
- [Shells](shells.md) — the `--shell` flag on `exec` / `session new`.
- [Automations](automations.md) — server-managed scheduled jobs.
- [Auto-start & remote access](auto-start.md) — `install` / `uninstall`.
