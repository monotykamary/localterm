# Shells

Every shell localterm spawns runs a real login shell. This page covers how to
pick which one, how the default is detected, the login-profile sourcing, and the
per-shell hooks (OSC 7 cwd tracking, git-dirty, automation-exit).

## Picking a shell

There are three layers, each more specific than the one below it.

### 1. Per tab (the Settings field)

**Settings → Launch → Default shell** saves an absolute path (e.g.
`/usr/bin/fish`) to `localStorage` and sends it as `?shell=` on every new
WebSocket this tab opens. The placeholder shows the daemon's detected default,
and an empty field falls back to that default.

The address bar wins for a single tab: `?shell=/usr/bin/fish` on the URL spawns
fish just for that tab (a programmatic launch / a bookmark), without changing
your saved default.

### 2. Per REST / CLI session

`localterm session new --shell /usr/bin/fish` (and `localterm exec --shell …`)
pass a `shell` field to `POST /api/sessions` / `POST /api/exec`. A path that
isn't an executable is rejected with `400 invalid_shell`, so an agent or script
gets feedback instead of a silently-different shell.

```bash
localterm session new --shell /usr/bin/fish --cwd ~/projects/foo --json
localterm exec "git status" --shell /usr/bin/zsh --json

# REST
curl -X POST "$BASE/sessions" -H 'content-type: application/json' \
  -d '{ "cwd": "/home/me/foo", "shell": "/usr/bin/fish" }'
curl -X POST "$BASE/exec" -H 'content-type: application/json' \
  -d '{ "command": "git status", "shell": "/usr/bin/zsh" }'
```

### 3. Globally

Set `LOCALTERM_SHELL` in the daemon's environment (the systemd unit / launchd
plist) before `localterm start`. This is the only knob a headless Linux VPS
reachable purely over ssh/tailnet can use without a browser tab open.

```bash
# in the systemd unit's [Service] or launchd plist Environment
LOCALTERM_SHELL=/usr/bin/fish
```

## How the default is detected

With no override, every new shell is spawned from the daemon's detected
default, resolved in order:

1. the `LOCALTERM_SHELL` env var,
2. your login shell from passwd (`os.userInfo().shell`),
3. `$SHELL`,
4. `/bin/sh`.

The first one that exists wins. `GET /api/config` returns both `defaultShell`
(the detected default) and `shells` (the host's `/etc/shells` list, with the
detected default first), so a client can show what's available.

## Login-profile sourcing

A shell spawned by localterm should behave like one you opened yourself —
aliases, PATH additions from `~/.zprofile` / `~/.bash_profile`, etc. all apply.
The hook setup sources the standard login files before your interactive rc:

- **zsh** — sources `~/.zprofile` (login env), then `~/.zshrc` / `~/.zshenv` as
  usual.
- **bash** — mimics `bash -l`: sources `/etc/profile`, then the first of
  `~/.bash_profile`, `~/.bash_login`, `~/.profile` that exists, and sources
  `~/.bashrc` only when none of those exist (so a shell that has a login file
  doesn't double-source `.bashrc` and duplicate PATH).
- **fish** — fish reads its own `~/.config/fish/config.fish` on startup; the
  hooks are injected with `-C` (run after config), so your config still loads.

## Per-shell hooks

localterm injects three hooks where the shell supports them. They power the
session switcher's cwd/path display, the git-dirty favicon, and the
automation-exit one-shot.

| Shell                  | OSC 7 (cwd) | git-dirty | automation-exit |
| ---------------------- | ----------- | --------- | --------------- |
| zsh                    | ✓           | ✓         | ✓               |
| bash                   | ✓           | ✓         | ✓               |
| fish                   | ✓           | ✓         | ✓               |
| others (nushell, etc.) | —           | —         | —               |

- **OSC 7** emits the current working directory after each command so the
  session switcher can show the path and title.
- **git-dirty** marks the prompt when the cwd is in a dirty git repo, which
  colors the switcher row and tab favicon.
- **automation-exit** is a one-shot that fires the exit status of the most
  recent command exactly once on the second prompt after it ran — used by the
  automation run-status detection (the same shape across zsh/bash/fish).

Other shells run unhooked — they still work as terminals, but the switcher
won't track cwd or git-dirty until support is added for that shell.
