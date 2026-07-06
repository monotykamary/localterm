# Automations

Schedule commands as server-managed jobs. When one is due, localterm opens a new
browser tab in the automation's directory and runs the command in a fresh shell —
the tab stays open afterwards so you can see that it ran and whether it
succeeded. The tab opens in the **background** so a scheduled run never steals
your focus (via the DevTools Protocol over a connection opened once at start
when a Chromium browser has remote debugging on, otherwise the OS opener / macOS
`open -g`; set `LOCALTERM_DISABLE_CDP_TABS=1` to force the fallback).

## Triggers

- **Schedule** — friendly presets (daily, weekdays/weekends, specific days,
  multiple times a day, every N minutes/hours) with raw 5-field cron as an
  advanced escape hatch. Evaluated in local time.
- **Folder change** — the job runs when its directory changes, detected via
  native filesystem events (no polling). Bursts are debounced into one run and
  a new run won't start while a previous one is still going, so a command that
  writes into the watched folder won't loop.
- **Session event** — fire on git ref changes (commit, push, checkout, reset),
  a custom shell notification (`printf '\e]9;name\a'`), and other session events
  matching the automation's `cwd`.
- **Webhook** — an external `POST /api/webhooks/<id>` fires it; the `id` is a
  server-generated capability token (anyone with the URL can fire it) and the
  body is ignored.

## Runners

- **shell** (`{kind:"shell", command}`) — types `command` into a fresh shell in
  a new browser tab. Shell syntax (`&&`, pipes) works; max 4096 chars. The tab
  stays open after the command finishes; its exit code drives the run status.
- **agent** (`{kind:"agent", prompt, sessionMode, model?, thinking?}`) — runs an
  agent session **headlessly** in the daemon (no tab, no PTY) and reports
  findings plus a transcript. `sessionMode` is `fresh` (ephemeral) or `thread`
  (resumes one persistent session per fire). See
  [the agent-runner reference](../skills/localterm/references/agent-runner.md)
  for the harness (built-in `pi` over `pi --mode rpc`, or a custom command),
  model/thinking knobs, the transcript log, compaction, and Triage.

## Options

- **Run limit** — "stop after N runs"; when reached it's marked **finished** and
  stays listed until you reset it. Or run forever.
- **Close tab when finished** — a run's tab closes once its command exits (needs
  the CDP background-tab path; off until a debug-enabled Chromium is connected).
  Off by default — tabs stay open so you can see what ran.
- **Recent runs** — a per-automation history shows which runs succeeded, failed,
  were missed, or were **skipped** because the machine was asleep (reconstructed
  when the daemon next starts).
- **Secrets** — `requestedSecrets` names the secrets (by stable id) whose values
  are injected as env vars into the run's PTY (shell) or subprocess (agent) at
  spawn — opt-in least-privilege, exactly the secrets named and nothing else.

Definitions persist in `~/.localterm/automations.json`; the daemon must be
running for jobs to fire.

## Browser detection

Enable remote debugging by launching your browser with
`--remote-debugging-port=9222` (e.g.
`open -na "Google Chrome" --args --remote-debugging-port=9222`), or by toggling
"Discover network targets" in `chrome://inspect`. localterm auto-detects any
debug-enabled Chromium in a known user-data dir (Chrome, Chromium, Edge, Brave,
Arc, Vivaldi, Opera, Comet, Dia, **Aside**, Canary) by reading its
`DevToolsActivePort` file, most-recently-launched first.

To pin a specific port instead (e.g. Aside's `52860` when several browsers are
running), set **Settings → Automation browser → Remote debugging port**; the
daemon probes that port first and falls back to auto-detect when it's
unreachable. `localterm status` shows whether the daemon is connected via CDP.

## API & UI

Open the full-screen panel from the top-right toolbar (calendar icon) or with
<kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>. Everything is also available over HTTP at
`/api/automations` (list/create/update/delete/run-now/reset).

Agents can manage automations too — install the API playbook as a skill with
[`skills`](https://github.com/vercel-labs/skills):

```bash
npx skills add monotykamary/localterm
```

See the [skills SKILL.md](../skills/localterm/SKILL.md) for the full curl surface
and the agent playbook.
