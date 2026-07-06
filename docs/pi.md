# pi integration

[pi](https://github.com/earendil-works/pi-coding-agent) runs first-class inside
localterm. The `@monotykamary/pi-localterm` extension wires the two together with
two features, both inert outside localterm.

## Kitty graphics + OSC 8 links

localterm's xterm.js renderer supports the Kitty graphics protocol and OSC 8
hyperlinks, but sets `TERM=xterm-256color` so pi-tui can't detect them. The
extension force-enables them so images and links render in the browser.

## Secret scrubbing for pi's bash tool

localterm injects each secret only into the shimmed process's env (pi's), but
pi's bash tool spawns commands with `{ ...process.env }`, so without the
extension the agent's commands would inherit every secret pi received. The
extension overrides the `bash` tool with a spawn hook that strips the `pi`
process's localterm-managed secret env vars from each command's child env — pi's
own env (and its provider calls) keep them. This is defense-in-depth, not a hard
barrier (see the package README for the threat model).

## Install

From npm:

```bash
pi install npm:@monotykamary/pi-localterm
```

Or from source:

```bash
git clone https://github.com/monotykamary/localterm
pi -e ./localterm/packages/pi-extension
```

See [`packages/pi-extension/README.md`](../packages/pi-extension/README.md) for
the full install guide, how the scrub mirrors the shim 1:1, and what it does and
doesn't protect against.

## Agent automations

localterm can also run pi **headlessly** as an automation runner (no tab, no
PTY) — the built-in harness over `pi --mode rpc`, fresh or thread sessions, with
findings and a transcript. See
[the agent-runner reference](../skills/localterm/references/agent-runner.md) and
[Automations](automations.md).
