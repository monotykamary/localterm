## General Rules

- MUST: Use pnpm directly. Use `pnpm install` to install, `pnpm run <script>` (or `pnpm <script>` for the well-known scripts) to run, `pnpm remove` to uninstall.
- MUST: Use TypeScript interfaces over types.
  - Carve-out: discriminated unions, conditional types, mapped types, and `z.infer<...>` aliases must use `type` (TypeScript does not allow `interface X = A | B`). Object shapes still use `interface`.
- MUST: Keep all types in the global scope.
- MUST: Use arrow functions over function declarations
  - Carve-out: vendored generated files under `apps/*/src/components/ui/**` and `apps/*/src/lib/utils.ts` are managed by the shadcn CLI (`shadcn add --diff`) and must keep upstream form (named `function` declarations) so smart-merge upgrades stay diffable.
- MUST: Default to NO comments. Only add a comment when the user explicitly asks, or when the "why" is truly non-obvious - browser quirks, platform bugs, performance tradeoffs, fragile internal patching, or counter-intuitive design decisions. Never add comments that restate what the code does or what a well-named function/variable already conveys. When in doubt, leave the comment out.
  - Do not delete descriptive comments >3 lines without confirming with the user
- MUST: Use kebab-case for files
- MUST: Use descriptive names for variables (avoid shorthands, or 1-2 character names).
  - Example: for .map(), you can use `innerX` instead of `x`
  - Example: instead of `moved` use `didPositionChange`
- MUST: Frequently re-evaluate and refactor variable names to be more accurate and descriptive.
- MUST: Do not type cast ("as") unless absolutely necessary
- MUST: Remove unused code and don't repeat yourself.
- MUST: Always search the codebase, think of many solutions, then implement the most _elegant_ solution.
- MUST: Put all magic numbers in `constants.ts` using `SCREAMING_SNAKE_CASE` with unit suffixes (`_MS`, `_PX`).
- MUST: Put small, focused utility functions in `utils/` with one utility per file.
- MUST: Use Boolean over !!.

## Testing

Do NOT run `pnpm test` / `pnpm lint` / `pnpm typecheck` / `pnpm format` as part of your normal turn flow or to "verify your work" before responding. These are slow, and running them mid-task just stalls iteration. Run the full suite exactly once — at the very end, when the user signals the whole task is complete and no more iteration is expected (the dust has fully settled). Not per-turn, not per-commit, not before sending a response.

### Test tiers

The suite is split by flake risk so the agent never burns a turn chasing a fail-then-pass:

- `pnpm test` — **deterministic unit tests only** (the default; fast, no real timers/waits). This is the green gate.
- `pnpm test:integration` — **integration tests** (real PTY / WebSocket / child process), tagged `@integration`. Run on demand, not every turn.
- `pnpm test:e2e` — **e2e tests** (real browser / HTTPS / OIDC), tagged `@e2e`. On demand; `e2e-sso-browser` also needs a Chrome binary present.

### Running the suite (one run, one file)

Never invoke `pnpm test` twice (once to tail, once to grep) — that doubles the wait. Redirect the single run to a temp file (pi overflows large output to disk, so your context stays clean), then read the failure list and the tail from that one file:

```bash
pnpm test > /tmp/localterm-test.log 2>&1
grep -E "FAIL |Test Files|Tests " /tmp/localterm-test.log | head -40   # the failed tests
tail -25 /tmp/localterm-test.log                                       # the run summary
```

The other end-of-task checks:

```bash
pnpm lint
pnpm typecheck
pnpm format
```

`pnpm format` mutates files — always `git diff` afterward and include any formatting changes in the commit.

### Flaky-test stance

`pnpm test` (the main suite) MUST stay deterministic: no `await wait(N)`, no `pollFor`, no bumped `testTimeout` / `hookTimeout` to paper over load. A test that fails-then-passes is a bug — fix it by first principles (extract pure logic, `vi.useFakeTimers()`, inject fakes) or move it to the `@integration` / `@e2e` tier via a vitest `tags` option. Genuine end-to-end coverage (real shell / WebSocket / browser) belongs in `pnpm test:integration` / `pnpm test:e2e`, never in the main suite. Make-deterministic-first where feasible; gate the rest.

## Development instructions

This is a pnpm monorepo with `apps/` (playgrounds, sites, extensions) and `packages/` (libraries, tools). No external services (databases, Docker, etc.) are required.

### Build before test

`pnpm build` must complete before `pnpm test` or `pnpm lint`. After modifying source files, always rebuild before running tests.

### Approved build scripts

`pnpm-workspace.yaml` has `onlyBuiltDependencies` configured for `@parcel/watcher`, `esbuild`, `node-pty`, `sharp`, `spawn-sync`, and `unrs-resolver`. Without this, `pnpm install` silently skips their native builds and downstream packages may fail.

### Key commands reference

See root `package.json` scripts for the full list. Quick reference:

- **Install**: `pnpm install`
- **Build**: `pnpm build`
- **Dev watch**: `pnpm dev`
- **Lint dead code**: `pnpm lint:dead` (runs `knip` to find unused files, exports, and dependencies)
