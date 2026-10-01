# macOS PTY resource regression

Run from the repository root:

```sh
bun run --cwd packages/server test:integration tests/node-pty-resources.test.ts
```

The test applies the **checked-in Bun patch** to a temporary directory and compiles
its native spawn helper with simulated syscalls. It covers all combinations of
closed standard descriptors, every allocation/setup/spawn failure, interrupted
spawns, optional terminal settings, and 1024 successful spawn/exit cycles. It
asserts that only the PTY master is transferred on success, no handles survive a
failure, and only one PTY is allocated per spawn. It also checks the scoped owner
used by the exit watcher's kqueue. No actual shell, PTY, or process signal is used.
A C++17 compiler and Git are required; this belongs to the integration test tier.

The server's mocked failure coverage is separate:

```sh
bun run --cwd packages/server test tests/session-spawn-failure.test.ts
bun run --cwd packages/server test:integration tests/session-spawn-api.test.ts
```

The release prepack builds both macOS architectures in an isolated install and
ships them under the server package's `vendor/node-pty`. Linux continues to use
its ordinary platform-native registry dependency. The source worktree fallback
still needs Bun's patch applied; it is not a substitute for checking tarballs.

After building/preparing the server, or after extracting/installing its tarball:

```sh
node harness/node-pty-resources/probe.mjs /absolute/path/to/server-package
```

The probe uses the server's real backend selector. Any test shells exit naturally;
it never signals an existing process or talks to the running daemon. On an
exhausted host it tests repeated allocation failures instead and reports that
success-path coverage is unavailable.

For a real-backend check, rebuild node-pty in an **isolated copy**, never in place
while a daemon has its native module loaded. In a separate Node process, record
its open descriptors, repeatedly spawn `/bin/sh -c 'exit 0'` and await `onExit`,
then compare PTY and kqueue counts. Also repeat failed spawns while the PTY pool is
exhausted. Do not raise system limits or terminate existing sessions just to make
the success probe possible. Fault injection covers success independently of the
machine's available PTYs, but is not a substitute for the real success probe on
a host with free PTYs.
