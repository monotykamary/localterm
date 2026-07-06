# localterm docs

Detailed guides for every feature. New here? Start with the [README](../README.md)
for the one-command install, then dig in here.

| Guide                                       | What it covers                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Usage](usage.md)                           | The mental model — shell = tab, the grace window, the session switcher, reloading vs switching.                                                              |
| [Shells](shells.md)                         | Picking a shell per tab / per CLI call / globally; how the default is detected; login-profile sourcing; per-shell hooks (OSC 7, git-dirty, automation-exit). |
| [Appearance](appearance.md)                 | Themes (built-in list, **importing JSON + iTerm `.itermcolors`**, **creating your own**, Auto/system), fonts (bundled, custom Nerd Font).                    |
| [Automations](automations.md)               | Scheduled + watch + event + webhook jobs; shell vs agent runners; the run lifecycle.                                                                         |
| [Auto-start & remote access](auto-start.md) | macOS launchd, Linux systemd, Tailscale, ssh tunnels, the headless-VPS story.                                                                                |
| [Identity & SSO](identity.md)               | Multi-user access via `header`, `passkey`, or `oidc`; config + examples.                                                                                     |
| [pi integration](pi.md)                     | Kitty graphics, OSC 8 links, secret scrubbing for pi's bash tool.                                                                                            |
| [Security](security.md)                     | Loopback binding, DNS-rebinding defense, safe sharing.                                                                                                       |
| [CLI reference](cli.md)                     | Every `localterm` command and flag.                                                                                                                          |

For contributing, see [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md).
