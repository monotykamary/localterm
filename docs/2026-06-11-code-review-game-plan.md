# Code Review Game Plan — 2026-06-11

Source: full-codebase review (server, CLI, terminal frontend, build/tests) run on `main` @ `d605ec1`.
Work through phases in order; each phase is independently shippable. Check items off as they land.

---

## Phase 1 — Distribution & security correctness (highest impact)

These affect every published-package user or are user-facing breakage.

- [x] **1.1 Runtime-detect 5-arg resize and degrade gracefully** (HIGH)
  - The patched node-pty is correctly configured in `pnpm-workspace.yaml`. Patch bugs fixed
    (`info.Length() >= 4` for xpixel, `IsNumber()` validation on args 3/4).
  - Implemented option (c): `session.ts` detects at first call whether `node-pty.resize`
    accepts 4+ args. If not, falls back to 2-arg resize. The `pixelResizeSupported` flag
    is cached per-session so the probe runs at most once.
  - Remaining: options (a) publish a fork or (b) vendor are deferred until users report
    the pixel-size issue with published packages.

- [x] **1.2 `Host: localhost:<port>` rejected with 403** (MEDIUM, user-facing)
  - Fixed: `stripPort` now treats as bare IPv6 only when 2+ colons before port stripping.
  - Tests added: `localhost:3417`, `foo.localhost:3417`, `[::1]:3417`.

- [x] **1.3 Pin the vite override; eliminate engine drift** (HIGH, build)
  - Moved `onlyBuiltDependencies`, `overrides`, `patchedDependencies` from `package.json`
    to `pnpm-workspace.yaml` (pnpm v10 ignores the `pnpm` field in package.json).
  - Single pinned vite override (`@^0.1.12`) in workspace yaml only.
  - `pnpm why vite` confirms single engine resolution.

- [x] **1.4 Non-loopback auth warning** (HIGH, minimum version)
  - CLI `start.ts` and server `index.ts` both `console.warn` when binding to a non-loopback
    host, warning that any client on the private network can open an unauthenticated shell.
  - Full bearer-token auth design remains open for a future iteration.

---

## Phase 2 — Quick-wins batch (small, independent, one PR)

CLI:

- [x] **2.1** Invalid `PORT` env crashes every command — now parsed lazily with warning+fallback.
- [x] **2.2** `stop`/`status` set `process.exitCode` on error paths.
- [x] **2.3** `isAlive` treats `EPERM` as alive (process exists, other owner).
- [x] **2.4** Start preflight verifies PID is localterm via `verifyPidIsLocalterm`;
      PID/port/host writes are atomic (temp-file-then-rename).
- [x] **2.5** `stop` polls `isAlive` briefly after SIGKILL.
- [x] **2.6** `scripts/fix-node-pty.mjs` resolves from `@monotykamary/localterm-server/package.json`
      and logs when node-pty isn't found; fixed syntax (was TypeScript in .mjs).
- [x] **2.7** Orphaned `server.port` file cleared together with pid; `status` reports
      "pid alive, port unknown" and "stale port file removed" for edge cases.
- [x] **2.8** Host persisted alongside port; health probe and status use persisted host
      instead of hardcoded `127.0.0.1`.

Server:

- [x] **2.9** `wss.options.maxPayload = 256 * 1024` set on the WS server.
- [x] **2.10** Persistent log-only HTTP error listener added after bind.
- [x] **2.11** Shell rc/zdot files use `mkdtempSync` with mode `0o700` + file mode `0o600`
      (was world-readable temp paths).
- [x] **2.12** `FOREGROUP_*` → `FOREGROUND_*` typo fixed; stop-grace comment moved to
      `SERVER_STOP_GRACE_MS`.

Packaging:

- [x] **2.13** npm bin key changed from `@monotykamary/localterm` to `localterm`.
- [x] **2.14** Repo identity aligned to `monotykamary/localterm` everywhere.
- [x] **2.15** `@xterm/addon-webgl` `0.20.0-beta.285` doesn't exist yet; kept at `beta.284`.

---

## Phase 3 — Frontend bugs (apps/terminal)

- [x] **3.1 Nerd Font toggle is non-functional** (MEDIUM)
  - `buildFamily` now takes `nerdEnabled` parameter; `familyForFont(font, nerdEnabled)`
    used in terminal.tsx for both initialization and refit effect.

- [x] **3.2 Reconnect race: probe loop can kill a fresh session** (MEDIUM)
  - Added `wsConnectedRef` tracking socket state; probe callback bails if connected.
  - Fixed stale closure deps: added `effectiveCursorStyle`/`activeCursorBlink` to deps.

- [x] **3.3 Double scroll-restore with contradictory shrink behavior** (MEDIUM)
  - `restoreTerminalScrollAnchor` now falls back to bottom when anchor distance exceeds
    buffer (matches `fitTerminalPreservingScroll` behavior).

- [x] **3.4** Custom scrollbar geometry updated on resize and after batcher flush.
- [x] **3.5** `history.replaceState` skips when unchanged + try/catch for Safari rate limit.
- [x] **3.6** Whitespace-only stored values guarded with `raw.trim()` and `Number.isFinite`.
- [x] **3.7** Dropped the React-managed-ref nulling in cleanup.
      Removed `manualReconnectRef`, `refocusTerminalRef`, `searchAddonRef`, `terminalRef`,
      `fitAddonRef`, `scrollbarTrackRef`, `scrollbarThumbRef` null assignments from the
      mount-effect cleanup. These refs are never read after unmount. `terminalInitializedRef`
      is still reset to `false` (it gates re-initialization on re-mount).
- [ ] **3.8** (perf, optional) `noteOutputActivity` timer churn — deferred.

---

## Phase 4 — Test coverage

- [x] **4.1 Server WS-lifecycle integration test**
  - `tests/index.test.ts`: session frame on connect, registry tracking, unregister on close,
    input→output echo, invalid JSON rejection, capacity close (4503), health check, stop cleanup.

- [x] **4.2** Regression test for 1.2 (`localhost:<port>` allowed) in `security.test.ts`.

- [x] **4.3** `parse-osc7` unit test: BEL/ST terminators, multiple sequences, URL-encoded
      paths, malformed URLs, chunk-split sequences.

- [x] **4.4** CLI lifecycle tests
  - `tests/commands/stop.test.ts`: not-running, stale-pid, pid-not-ours, SIGTERM,
    SIGKILL escalation, signal failure exit code, SIGKILL-resistant process warning.
  - `tests/commands/status.test.ts`: not-running, stale-port, dead-pid, port-unknown,
    health-endpoint success with output verification, host fallback, health-failure exit code.

- [x] **4.5** Frontend health-probe utility test
  - `probe-server-health.test.ts`: returns true on 200, false on non-200, false on network error.
  - Full reconnect state-machine testing depends on Phase 5.1 (terminal.tsx hook extraction).

---

## Phase 5 — Structural refactors (do after bugs, before they multiply)

- [ ] **5.1 Split `terminal.tsx`** — deferred (1,672 lines; incremental hook extraction).
- [x] **5.2 `createStoredSetting` factory**
  - Created `create-stored-setting.ts` with four factory variants: `createNumericStoredSetting`,
    `createBooleanStoredSetting`, `createStringValidatedStoredSetting`,
    `createStringLookupStoredSetting`.
  - Merged 22 load+store file pairs into 11 unified `stored-*.ts` files. Deleted the old
    separate `load-stored-*` and `store-*` files. Updated all imports in `terminal.tsx`
    and existing tests.
- [x] **5.3** Delete dead code: `errors.ts` (zero imports → deleted), `schemas.ts` shim
      (replaced with direct import), `is-find-shortcut`/`is-command-palette-shortcut` merged
      via `is-keyboard-shortcut-with-key` factory.

---

## Phase 6 — Docs & config hygiene

- [x] **6.1** README: "no reconnects" → documented actual auto-reconnect semantics.
- [x] **6.2** AGENTS.md: `onlyBuiltDependencies` reference updated to `pnpm-workspace.yaml`
      with `node-pty` included.
- [x] **6.3** CONTRIBUTING.md: noted node-pty source-build requirement (Xcode CLT / build-essential).
- [x] **6.4** turbo.json: added `"dev": { "dependsOn": ["^build"] }`; removed dead
      `lint`/`format`/`check` tasks and `.next/**` output.
- [x] **6.5** Commented the intentional output fast-path schema bypass.
      Added a 4-line comment block explaining why `type === "output"` is checked before
      the zod schema parse (traffic dominance, stable server shape, latency on fast scrollback).
- [x] **6.6** Fixed doc rot in `escape-css-font-family.ts` (removed "Local Font Access" fallback reference).

---

## Suggested sequencing

| PR  | Contents                                   | Risk                                                      |
| --- | ------------------------------------------ | --------------------------------------------------------- |
| 1   | 1.2 + 1.3 + regression test (4.2)          | Low — small, well-understood                              |
| 2   | Phase 2 quick-wins batch                   | Low — independent one-liners                              |
| 3   | 1.1 node-pty distribution fix              | Medium — touches publish pipeline; verify with `npm pack` |
| 4   | Phase 3 frontend bugs                      | Medium — manual verify reconnect/scroll behavior          |
| 5   | 4.1 + 4.3 + 4.4 test coverage              | Low — tests only                                          |
| 6   | 1.4 auth (needs a design decision first)   | Medium                                                    |
| 7+  | Phase 5 refactors, one hook/factory per PR | Medium — guarded by Phase 4 tests                         |
| 8   | Phase 6 docs sweep                         | Trivial                                                   |
