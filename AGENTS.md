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
- Build before packing. Run `bun pm pack --destination <temp-dir>` from each
  package directory, not the private root. Let the CLI prepack hook run: it
  copies the built terminal UI, README, and LICENSE and checks native resources.
- Inspect **the tarballs**, not only the source manifests. Check package names
  and versions, runtime dependency protocols, the exact server pin, all server
  export targets, CLI entry points, terminal HTML/assets, and executable native
  resources. Every new production import needs a shipped runtime dependency.
- Smoke-test installation in a fresh directory outside the monorepo, without
  workspace links or a global LocalTerm install masking missing dependencies.
  CLI `--version`/`--help` and importing server modules do not require starting
  a daemon. A test-only dependency override is not proof of registry resolution.
  For Bun, use `--linker hoisted --backend copyfile --cache-dir ./package-cache`
  and verify resolved realpaths stay inside the consumer directory: the default
  linker can otherwise reuse the global virtual store.
- Publish the **inspected tarballs** from their corresponding package directories
  with `bun publish --access public <tarball>`; Bun's bin-path validation is
  cwd-sensitive even when the archive already contains the executable.
  Publish the server first and confirm that exact version is available from the
  registry before publishing the CLI that depends on it. Never rely on Bun to
  rewrite a workspace protocol during publishing. A publish acknowledgement is
  not download readiness: metadata and tarballs can take minutes to propagate.
  Check the registry's `?write=true` package metadata and download its actual
  `dist.tarball` URL. Retry bounded, read-only verification on temporary 404s;
  do not blindly republish a version that the registry has already accepted.
- Verify registry versions, dependency metadata, and tarball integrity afterward.
  Commit the version/changelog/lockfile changes and push the release commits and
  matching package-version tags. Never republish different bytes under an
  existing version; fix forward with a new version.
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
