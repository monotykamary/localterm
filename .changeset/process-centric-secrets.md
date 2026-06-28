---
"@monotykamary/localterm-server": minor
"@monotykamary/localterm": minor
---

Flip secret injection from secret-centric to process-centric, mirroring the automations multi-select flow.

Secrets used to carry the binaries they shims (`secret = { name, envVar, programs[] }`), so you assigned programs per secret. Now a secret is just an identity + the env var it exports (`{ name, envVar }`), and a **process** is a binary that names which secrets it receives (`{ name, requestedSecrets[] }`) — the same multi-select model automations already use for `requestedSecrets`. The shim generator now reads processes directly (no inversion): one shim per process, baking each requested secret's `envVar` from the store.

**Cascade parity (the automations path was missing this):** deleting a secret now strips its name from every automation's and process's `requestedSecrets`, regenerates shims, and re-broadcasts automations — so no container keeps a dangling name a run/shim would silently skip. `removeSecretFromAll` was added to both `AutomationStore` and `ProcessStore`.

**One-time in-place migration:** a v1 `secrets.json` (with `programs`) is rewritten to v2 (stripped) plus a new `processes.json` built by inverting `programs` — a program listed by several secrets becomes one process requesting all of them. Runs once at startup before the stores load; idempotent; invalid program names are dropped with a warning so it never writes an un-loadable file. No backwards compatibility is kept — the stores only know the new shapes.

**REST surface:** `GET/PUT/DELETE /api/processes/:name` (`PUT` body `{ requestedSecrets }`, rejects unknown names with `invalid_secret`); secrets routes dropped `programs`. **CLI:** `localterm process list|set <name> [-s a,b]|delete`, and `localterm secret set` lost `-p/--programs` (use `process set` to wire binaries). **UI:** the secrets modal gains a Processes tab (Secrets ⇄ Processes, the automations tab pattern) with the same `SecretSelector` multi-select; the standalone processes menu entry is gone. Secret and process names are now immutable (a rename would silently disconnect cascade wiring — delete and recreate to rename); `envVar` stays editable.

Also fixes the secrets modal showing only one row on first open: it used a fragile `scrollHeight - getTotalSize()` measurement that under-sized the body before rows measured. Dropped for the worktrees pattern (list div sized directly from `getTotalSize()`).
