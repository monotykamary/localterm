---
"@monotykamary/localterm-server": minor
---

Add a `webhook` automation trigger: an external `POST /api/webhooks/<id>` fires the automation.

The trigger union gains a fourth kind. A webhook automation's `id` is a server-generated 128-bit base64url capability token (Discord-style: anyone with the URL can fire it) — the client sends `{kind:"webhook"}` with no id at create time and reads the id back from `trigger.id`. The id is preserved across PATCHes that keep the webhook kind (so editing the command/name never rotates the URL configured in CI) and guaranteed unique across all automations. The POST body is ignored: `command`/`cwd` are fixed at create time, so a webhook is a pure signal like schedule/watch/event — no payload templating, no injection surface. A new `WebhookTriggerManager` mirrors the watch/event managers: a trailing debounce coalesces duplicate delivery (a CI retry, an LB double-fire) into a single run, and an in-flight guard drops a POST that arrives while a prior run is still launching/running. Webhook runs count toward the `limit`.

The route returns `202 {"accepted":true}` on a valid+active id (always 2xx so a CI retry loop never amplifies — duplicates coalesce, in-flight POSTs are silently dropped), `404 {"error":"not_found"}` for an unknown id, and `409 {"error":"automation_not_active"}` when disabled/finished. The existing network policy middleware already gates the endpoint to the bound surface: loopback-only on a loopback bind, or any private host (incl. tailscale's `100.64.0.0/10` CGNAT range) on a non-loopback bind — so a POST from another tailnet device reaches it with no extra wiring. The terminal app's automation modal adds "On a webhook" as a fourth trigger type and shows the webhook URL (with a copy button) in the detail view, built from the page's own origin so it tracks the surface the user is browsing (tailnet / portless / loopback).

To keep `node:crypto` out of the terminal app's browser bundle, trigger normalization (which generates the webhook id) moved from `compile-schedule.ts` (imported by the browser for cron preview) into a new server-only `utils/normalize-trigger.ts`.
