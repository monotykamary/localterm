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
  advanced escape hatch. Calendar schedules use an explicit IANA timezone; older
  definitions without one keep using the daemon's local timezone. **Elapsed
  intervals** run every N minutes/hours/days from an anchor instant, independent
  of clock boundaries or daylight saving time. Existing clock-aligned schedules
  keep their behavior.
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
- **Recent runs** — shows completed, failed, queued, interrupted, missed, and
  skipped work, with a reason when a run did not execute. Clearing history keeps
  active and queued work; it never cancels a job.
- **Secrets** — `requestedSecrets` names the secrets (by stable id) whose values
  are injected as env vars into the run's PTY (shell) or subprocess (agent) at
  spawn — opt-in least-privilege, exactly the secrets named and nothing else.

Definitions persist in `~/.localterm/automations.json`; the daemon must be
running for jobs to fire.

## Planning and safety

The editor previews the next several occurrences in the chosen timezone.
**Upcoming** shows a bounded seven-day agenda in your browser's timezone, with
project/search filters and a separate view of active and queued work. Paused,
finished, and event-only automations are identified rather than given invented
run times. Future slots are plans, not guaranteed executions.

- **If already running** (`concurrencyPolicy`): `skip` (default), `queue-latest`
  (keep only the newest pending request), or `allow` (up to eight concurrent
  runs per automation). These rules include Run now. Persistent agent threads
  are always serialized; parallel thread configurations are rejected. Folder
  and session-event triggers additionally suppress activity during a run and
  its cooldown to avoid self-trigger loops. Webhooks use the shared policy.
- **If a scheduled run is missed** (`missedRunPolicy`): `skip` (default) or
  `run-latest` (one catch-up run, never an entire backlog). Applies after both
  daemon downtime and a sleep gap while the daemon remains running. A current
  occurrence still fires normally. Only the most recent ten missed occurrences
  within a fourteen-day lookback are reconstructed.
- **Queued work** is persisted with its accepted command/prompt and execution
  settings. You can cancel it before it starts. Pausing cancels automatic queued
  work; changing the run limit is checked again before dispatch. Run limits count
  actual automatic launch attempts, not queued/skipped/cancelled/manual requests.
- **Restart recovery** resumes accepted queued work. A launch that had already
  begun becomes `interrupted`, not automatically retried: external side effects
  may already have happened. Occurrence watermarks prevent duplicate scheduling
  across restarts and history cleanup. This is not an exactly-once guarantee for
  external commands. The daemon still needs to be running for on-time execution.

Calendar schedules skip nonexistent spring-forward times and may run at both
instants of a repeated fall-back time. A true elapsed interval does not shift
with DST. Thread compaction/reset and automation deletion are blocked while work
remains active or queued; cancel pending work or wait for completion first.

## Browser detection

**Preferred:** load the unpacked Chrome extension at
`packages/server/extension` (`chrome://extensions` → Developer mode → Load
unpacked). The worker relays CDP to the daemon over
`ws://127.0.0.1:3417/extension` — no `--remote-debugging-port`, no Allow popup.
`connect()` uses it when the worker is attached. If the daemon is not on port
3417, change `DEFAULT_PORT` in `extension/sw.js` to match. After a permission
change (`tabGroups`), reload the unpacked extension. The worker exposes extra
`Chrome.*` commands (tab groups, pin/mute/move, windows) and
`Browser.getWindowForTarget` / `getWindowBounds` / `setWindowBounds` on top of
the usual CDP `Target.*` / page domains.

**Fallback:** enable remote debugging by launching your browser with
`--remote-debugging-port=9222` (e.g.
`open -na "Google Chrome" --args --remote-debugging-port=9222`), or by toggling
"Discover network targets" in `chrome://inspect`. localterm auto-detects any
debug-enabled Chromium in a known user-data dir (Chrome, Chromium, Edge, Brave,
Arc, Vivaldi, Opera, Comet, Dia, **Helium**, Aside, Canary) by reading its
`DevToolsActivePort` file, most-recently-launched first.

**Dia on macOS.** Dia is the only Chromium browser that gates the debugging
connection behind an `Allow debugging connection?` prompt — Return dismisses
it. localterm auto-dismisses it: when the daemon's CDP socket is still
connecting past ~600ms it fires a Return at the Dia process via `osascript`, so
the socket opens with no manual click (a no-op for every other browser and off
macOS). It needs **macOS Accessibility** for **LocalTerm** when using the
installed LaunchAgent, or for the launching terminal when started manually.
Without it the keystroke is dropped and the socket just waits on its connect
timeout, so grant it once in System Settings → Privacy & Security →
Accessibility.

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
