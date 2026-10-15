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
- Watcher backend changes require the real-backend safety probes after building:
  `bun run --cwd packages/server test:integration tests/watch-filesystem-integration.test.ts`.
  Mocked outer watcher errors and server imports do not prove native error
  ownership or descriptor safety. macOS launchd defaults to 256 open files;
  per-file recursive watching can exhaust that budget. Chokidar 4's
  nonpersistent branch does not attach native asynchronous error handlers.

## Release packaging: verify what consumers receive

Release 2.79.4 shipped the CLI with a `workspace:*` server dependency; it worked
inside this monorepo but could not resolve for registry consumers. Release
2.79.5 fixed it by publishing an exact server version. A green workspace build
or test run alone does **not** prove a package is publishable.

- Keep `@monotykamary/localterm` and `@monotykamary/localterm-server` in the
  Changesets fixed release group. Use `bun run version`, then
  `bun install --ignore-scripts --lockfile-only` to refresh the lockfile.
  The private monorepo root version is not the CLI release version.
- `packages/cli/package.json` must pin its server dependency to the **exact
  released version**, matching both package versions. Never change it back to
  `workspace:*`. No published runtime dependency, optional dependency, or peer
  dependency may use `workspace:`, `file:`, or `link:`. Local protocols in
  private workspace packages are a different case.
- Keep `packages/cli/tests/publish-manifest.test.ts` green. It checks the
  local-only protocol ban and exact CLI/server version alignment; do not weaken
  it to make a version bump pass.
- Releases are published by CI, not from a workstation. Commit the versioned
  packages (`bun run version`, the lockfile refresh above) as the
  `chore(release): ...` commit and push it to `main`; `.github/workflows/publish.yml`
  then publishes every package version npm does not have, through npm Trusted
  Publishing; do not publish from a workstation. It runs on macOS,
  builds the workspace and the native resources, runs `bun run check` and the
  publish-manifest test, and packs each package from its own directory so the
  CLI prepack hook copies the terminal UI, README, and LICENSE.
- Before publishing anything, the workflow checks the tarballs as consumers
  receive them: no `workspace:`, `file:`, or `link:` runtime, optional, or peer
  dependency, the CLI pinning the server at their shared exact version, and a
  clean `npm install` of both tarballs outside the monorepo running
  `localterm --version` and `--help`. It publishes the server first and waits
  until its tarball downloads before publishing the CLI, then pushes the
  `<package>@<version>` tags. Rerun it from the Actions tab to retry; never
  republish different bytes under an existing version, fix forward instead.
- For changes the workflow cannot see (a new export target, native resource, or
  terminal asset), inspect locally first: `bun run build`, then
  `bun pm pack --destination <temp-dir>` from each package directory, and check
  package names and versions, all server export targets, CLI entry points,
  terminal HTML/assets, and executable native resources. Every new production
  import needs a shipped runtime dependency. The publish workflow's `dry_run`
  input builds, checks, and packs on CI without publishing.
- Do not restart or update a running LocalTerm daemon as a release smoke test.
  The repository's `bun run start` actually invokes `localterm restart` and can
  terminate the very session doing the release. Use isolated consumer checks.

## Conventions

- Kebab-case files; `interface` over `type` for object shapes
  (discriminated unions / `z.infer` may use `type`).
- Magic numbers go in `constants.ts` as `SCREAMING_SNAKE_CASE` with unit
  suffixes (`_MS`, `_PX`); small utilities live one-per-file under `utils/`.
- Comments only for the non-obvious "why" (platform quirks, fragile patches,
  perf tradeoffs); prefer descriptive names over comments.
- Conventional commits: `feat(scope): ...`, `fix(scope): ...`.
