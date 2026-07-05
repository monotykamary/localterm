---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Reorder the automations agent-runner form so the Session (fresh/thread) picker sits below the Model and Thinking inputs, and stop the `localterm status` test from spawning real `tailscale`/`portless` subprocesses and TCP probes by mocking `resolveDaemonUrl`.

**Form.** The agent runner's Session field now follows Model + Thinking (it previously sat between the prompt and the two pickers), keeping the per-run knobs grouped above the helper text and Harness section.

**Test.** `tests/commands/status.test.ts` reached `resolveDaemonUrl(port)` after its mocked `fetch`, which spawns `tailscale serve status`, `portless alias`, and loopback :443 TCP probes. Under turbo's parallel load those subprocess/probe timings pushed the case past its 5s default timeout (it passed in isolation). The test now mocks the module to a deterministic loopback result, mirroring the existing `setup-portless-proxy.test.ts` pattern.
