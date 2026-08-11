## Golden rule: check when done

During iteration on React code use `pnpm run doctor:react:changed` (touched
lines relative to `main`). When the task is complete — not between turns —
run the end gate once:

```sh
pnpm build
pnpm test
pnpm run doctor:react
pnpm lint
pnpm lint:dead
pnpm run lint:range
pnpm typecheck
pnpm format
```

`pnpm build` must precede `pnpm test` / `pnpm lint` — they consume built
artifacts. `pnpm format` mutates files; `git diff` afterward and include
its changes in the commit.

For long runs, redirect once to a temp file and grep/tail from that file
instead of rerunning: `pnpm test > /tmp/localterm-test.log 2>&1`, then
`grep -E "FAIL |Test Files|Tests " /tmp/localterm-test.log`.

## Test tiers

- `pnpm test` — deterministic unit tests only; the green gate.
- `pnpm test:integration` — `@integration` tagged (real PTY / WebSocket /
  child process). On demand.
- `pnpm test:e2e` — `@e2e` tagged; `e2e-sso-browser` needs a Chrome binary.

The main suite must stay deterministic: no `wait(N)` / `pollFor` / bumped
timeouts to paper over flakes. Fix from first principles
(`vi.useFakeTimers()`, injected fakes) or move the test to the
`@integration` / `@e2e` tier via a vitest `tags` option.

## Advisories

- pnpm workspace (`apps/`, `packages/`); use pnpm directly — `pnpm install`,
  `pnpm run <script>`. No external services are required.
- `pnpm-workspace.yaml` whitelists native builds via `onlyBuiltDependencies`.
  A new native dep without an entry silently skips its build and downstream
  packages fail mysteriously.
- `lint:dead` gates unused files/exports/deps (knip) — delete dead code
  rather than exporting around the check.
- React Doctor errors are blocking; fix diagnostics rather than suppressing.

## Conventions

- Kebab-case files; `interface` over `type` for object shapes
  (discriminated unions / `z.infer` may use `type`).
- Magic numbers go in `constants.ts` as `SCREAMING_SNAKE_CASE` with unit
  suffixes (`_MS`, `_PX`); small utilities live one-per-file under `utils/`.
- Comments only for the non-obvious "why" (platform quirks, fragile patches,
  perf tradeoffs); prefer descriptive names over comments.
- Conventional commits: `feat(scope): ...`, `fix(scope): ...`.
