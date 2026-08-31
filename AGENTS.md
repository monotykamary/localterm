## Golden rule: check when done

During iteration on React code use `bun run doctor:react:changed` (touched
lines relative to `main`). When the task is complete — not between turns —
run the end gate once:

```sh
bun run build
bun run test
bun run doctor:react
bun run lint
bun run lint:dead
bun run lint:range
bun run typecheck
bun run format
```

`bun run build` must precede `bun run test` / `bun run lint` — they consume built
artifacts. `bun run format` mutates files; `git diff` afterward and include
its changes in the commit.

For long runs, redirect once to a temp file and grep/tail from that file
instead of rerunning: `bun run test > /tmp/localterm-test.log 2>&1`, then
`grep -E "FAIL |Test Files|Tests " /tmp/localterm-test.log`.

## Test tiers

- `bun run test` — deterministic unit tests only; the green gate.
- `bun run test:integration` — `@integration` tagged (real PTY / WebSocket /
  child process). On demand.
- `bun run test:e2e` — `@e2e` tagged; `e2e-sso-browser` needs a Chrome binary.

The main suite must stay deterministic: no `wait(N)` / `pollFor` / bumped
timeouts to paper over flakes. Fix from first principles
(`vi.useFakeTimers()`, injected fakes) or move the test to the
`@integration` / `@e2e` tier via a vitest `tags` option.

## Advisories

- bun workspaces (`apps/`, `packages/`); use bun directly — `bun install`,
  `bun run <script>`. No external services are required.
- `package.json` whitelists native builds via `trustedDependencies` (source patches live in `patchedDependencies`).
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
