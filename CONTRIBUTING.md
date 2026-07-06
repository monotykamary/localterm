# Contributing to localterm

Thanks for your interest in contributing! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm >= 8

### Setup

1. Fork and clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/localterm.git
cd localterm
```

2. Install dependencies using [@antfu/ni](https://github.com/antfu/ni):

```bash
ni
```

The `node-pty` native addon requires a C++ toolchain (Xcode Command Line Tools on macOS, `build-essential` on Linux) because a source-build patch is applied via `pnpm-workspace.yaml` → `patchedDependencies`. Prebuilds are not used.

3. Build all packages:

```bash
nr build
```

4. Start development mode:

```bash
nr dev
```

## Project Structure

```
apps/         # playgrounds, sites, extensions
packages/     # libraries, tools
```

## Development Workflow

### Running Tests

```bash
pnpm test
```

### Linting & Formatting

```bash
nr lint        # Check for lint errors
nr lint:fix    # Fix lint errors
nr format      # Format code
```

### Dev server

`pnpm dev` runs the terminal's Vite dev server through portless at
`https://dev.localterm.localhost` (the daemon's `https://localterm.localhost`
hostname is reserved for the built daemon). The two `tsc --watch` packages keep
running in parallel via turbo. Escape hatch: `pnpm dev:app` runs `vp dev`
without portless.

### `localterm` binary from the working copy

Iterating via `pnpm cli` is fast but leaves no `localterm` binary on PATH, so
anything that calls `localterm ...` (scripts, docs, muscle memory) won't work.
Link the CLI globally from your checkout to get the binary without giving up
live rebuilds:

```bash
pnpm setup                         # once, if PNPM_HOME isn't configured yet
pnpm link --global ./packages/cli  # from the repo root, so the workspace dep resolves
```

The shim runs `packages/cli/dist/index.js` straight out of the checkout, so
`pnpm build` / `pnpm dev` rebuilds land on the next `localterm` call — no
reinstall. Unlink with `pnpm remove --global @monotykamary/localterm`.

Two gotchas:

- `pnpm link` also writes a `link:` dependency into `package.json`,
  `packages/cli/package.json`, and `pnpm-workspace.yaml` (and rewrites the
  latter's `allowBuilds`). Those are side effects, not intended edits — revert
  them so they don't get committed; the global shim lives in
  `~/Library/pnpm/bin` and is unaffected:

  ```bash
  git checkout -- package.json packages/cli/package.json pnpm-workspace.yaml pnpm-lock.yaml
  rm -f packages/cli/pnpm-workspace.yaml
  ```

- `prepack` (the `apps/terminal/dist` → `packages/cli/terminal` copy that ships
  the UI with the tarball) runs only on `pnpm pack` / `pnpm publish`, **not** on
  `pnpm build`. After a terminal-UI change, sync it manually; pure cli/server TS
  changes just need `pnpm build` since `localterm` reads `dist` live:

  ```bash
  pnpm build
  pnpm --filter @monotykamary/localterm run prepack
  ```

## Code Style

See `AGENTS.md` for the full set of rules. The highlights:

- **Use TypeScript interfaces** over types
- **Use arrow functions** over function declarations
- **Use kebab-case** for file names
- **Use descriptive variable names** - avoid shorthands or 1-2 character names
- **Avoid type casting** (`as`) unless absolutely necessary
- **Keep interfaces/types** at the global scope
- **Remove unused code** and follow DRY principles
- **Avoid comments** unless absolutely necessary

## Submitting Changes

### Creating a Pull Request

1. Create a new branch:

```bash
git checkout -b feat/your-feature-name
```

2. Make your changes and commit with a descriptive message:

```bash
git commit -m "feat: add new feature"
```

3. Push to your fork and open a pull request

### Commit Convention

We use conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `test:` - Test additions or changes

### Adding a Changeset

For changes that affect published packages, add a changeset:

```bash
nr changeset
```

Follow the prompts to describe your changes. This helps maintain accurate changelogs.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
