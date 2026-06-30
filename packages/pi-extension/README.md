# @monotykamary/pi-localterm

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that integrates [localterm](https://github.com/monotykamary/localterm) with pi. Two features, both inert outside localterm:

1. **Kitty graphics + OSC 8 links** — localterm renders xterm.js with the Kitty graphics and web-links addons loaded, but sets `TERM=xterm-256color` and strips terminal-identity env vars (so Ink TUIs don't probe for a protocol xterm.js lacks). pi-tui therefore reports images/hyperlinks as unsupported. This extension detects `LOCALTERM=1` (injected into every localterm PTY) and force-enables those capabilities, so images and links render in the browser.
2. **Secret scrubbing for the agent's bash tool** — localterm injects a secret only into the shimmed process's env (pi's), not its parent shell. But pi's bash tool spawns commands with `{ ...process.env }`, so without this the agent's commands would inherit every secret pi received. This extension overrides the `bash` tool with a spawn hook that deletes the `pi` process's localterm-managed secret env vars from each command's child env only — pi's own `process.env` (and its provider calls) keep them.

## Install

From npm (published package):

```bash
pi install npm:@monotykamary/pi-localterm
```

From source (this monorepo, for a one-off run):

```bash
git clone https://github.com/monotykamary/localterm
pi -e ./localterm/packages/pi-extension
```

<details>
<summary>Manual install (load on every session)</summary>

Clone and add the package to pi's global settings so it loads automatically:

```bash
git clone https://github.com/monotykamary/localterm ~/src/localterm
```

Then edit `~/.pi/agent/settings.json`:

```json
{
  "packages": ["/Users/you/src/localterm/packages/pi-extension"]
}
```

Or, for a project-only install, add the same path to `<cwd>/.pi/settings.json` instead. Then `/reload` in pi.

</details>

The extension auto-activates only inside localterm (`LOCALTERM=1`); outside localterm it registers nothing and pi behaves exactly as default.

## How the scrub works

localterm stores secret **policy** (names + the env var each exports) in `~/.localterm/secrets.json` and per-process wiring (`pi` → which secret names it receives) in `~/.localterm/processes.json`. **Only names and env vars — never values** (values live in the macOS Keychain). The extension reads those two files to find the env-var names the `pi` process is wired to, and strips exactly those from each bash-tool child's environment.

Resolution mirrors the shim 1:1: the shim injects the `pi` process's `requestedSecrets` (resolved to env vars); the scrub strips exactly that set. The strip set is recomputed on `session_start` (new / resume / fork / reload), so a policy change is picked up on the next session transition.

This extends localterm's existing least-privilege property — "the shimmed binary sees the key, its parent shell doesn't" — to "pi sees the key, the agent's bash commands don't." It converts silent env inheritance into an explicit, greppable `localterm secret get <name>` call when an agent's command genuinely needs a key.

## What this is not

This is **defense-in-depth, not a security boundary**. The keys still live in pi's own `process.env`, so a command the agent generates can recover them via parent-process introspection (`ps eww $PPID` on macOS, `/proc/$PPID/environ` on Linux) or by shelling out to `security find-generic-password` directly (the shim's own resolution path). The scrub stops passive/accidental leakage (`env`, `printenv`, a script reading `$VAR`), not active exfiltration by a prompt-injected or adversarial agent.

For untrusted or unmonitored agents, **don't wire secrets to the `pi` process at all** — give pi its provider keys through pi's own config, and run pi in a container/VM/micro-VM with short-lived credentials.

## Overriding the bash tool

The scrub overrides pi's built-in `bash` tool **by name** (extensions apply after the built-in in pi's tool registry). It reconstructs the tool via `createBashToolDefinition` and preserves a user's configured `shellPath` and `shellCommandPrefix` (read from `~/.pi/agent/settings.json` + `<cwd>/.pi/settings.json`) so the override is behavior-identical to the built-in apart from the env scrub. If another extension also overrides `bash`, only the first-registered one wins — that's a pi-level constraint.

## Requirements

- pi ≥ 0.80 (uses the `spawnHook` tool option and `createBashToolDefinition` export).
- localterm with `LOCALTERM=1` in the PTY environment (v0.7+). The scrub additionally needs localterm's secrets/processes policy files on the same machine.

## License

MIT
