---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Let an automation request exactly the secrets it needs, resolved into the run's PTY env at spawn — never over HTTP.

Automations type an arbitrary shell `command` into a tab, so a secret in that tab's env can be exfiltrated. Exposure is now **per-automation, opt-in, and least-privilege**: each automation carries a `requestedSecrets: string[]` (secret **names**, the stable identifier — not env vars) and defaults to `[]`, so an automation gets exactly the secrets it named and nothing else. A command alone can never reach a key the automation didn't explicitly request; the request list is a second, visible, auditable gate on top of the command.

Resolution happens at **launch time**, not claim time: when a run fires (schedule / watch / event / webhook / manual), the daemon resolves each named secret from the Keychain in parallel and stores the env on the pending run _before_ it opens the run tab. The WS that claims the run is therefore guaranteed to see the resolved env, and the synchronous `onOpen` spawn path just passes it through to the PTY. Resolution is fail-closed on both ends: unknown names are rejected at create/update with `400 {"error":"invalid_secret"}` (catches typos), and a name deleted after the automation was authored — or a secret with no value (locked Keychain / never set) — is silently skipped at run time rather than clobbering a pre-existing env var with an empty string.

The "values never cross the HTTP surface" property is unchanged: the value goes Keychain → daemon → PTY env, so the network-origin gate on `/api/*` is not widened. The env lives only in the run's shell process (and its children, e.g. `node scripts/update-models.js`), not the parent daemon or any other tab. The secrets store, schema, REST, and secrets modal are untouched — the field lives entirely on the automation.

The automations file is forward-compatible: `requestedSecrets` defaults to `[]` in the stored shape, so existing v3 files load unchanged and v1/v2 migrations synthesize `[]`. The terminal's automations modal gains a "Secrets to expose" section (one switch per secret, with its env var) so you select per-automation from the secrets you've already configured; the create/update REST input schemas accept the field and the wire response carries it via the existing `automationWithNextRunSchema` spread.
