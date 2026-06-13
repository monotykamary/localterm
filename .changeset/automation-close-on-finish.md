---
"@monotykamary/localterm-server": minor
---

Add an opt-in **Close tab when finished** setting to automations
(`closeOnFinish`, default false). When enabled, a run's browser tab is closed
once its command exits — mirroring browser-harness-js's `closeTab` (drive the
browser's own `window.close()` so forks like Dia/Arc actually drop the tab, then
tear down the CDP target, with closes serialized through a queue so concurrent
closes can't interleave and orphan tabs). Only honored for tabs opened via CDP;
on the OS-opener
fallback it's a silent no-op. The HTTP API accepts `closeOnFinish` on create and
update, and the automations modal exposes it as a toggle. Pre-existing
automations default to keeping tabs open, unchanged.
