import { spawn } from "node:child_process";
import {
  CAFFEINATE_ARGS,
  CAFFEINATE_BINARY,
  SYSTEMD_INHIBIT_ARGS,
  SYSTEMD_INHIBIT_BINARY,
} from "./constants.js";
import type { CaffeinateProcessHandle } from "./caffeinate-controller.js";
import { findBinaryOnPath } from "./utils/find-binary-on-path.js";

export interface KeepAwakeSpawnTarget {
  binary: string;
  args: readonly string[];
  // Spawned as a new session/process-group leader so a group kill reaps any
  // child the binary forks. macOS `caffeinate` is a single process (no child),
  // so a plain child.kill() suffices; Linux `systemd-inhibit` forks `tail`,
  // which would orphan to init without the group kill.
  detached: boolean;
}

// The keep-awake binary + args for a given platform, or null where keep-awake
// has no implementation (anything but macOS/Linux). Pure so tests can assert
// the per-platform spawn target without running on that host.
export const keepAwakeSpawnTarget = (
  platform: NodeJS.Platform = process.platform,
): KeepAwakeSpawnTarget | null => {
  if (platform === "darwin") {
    return { binary: CAFFEINATE_BINARY, args: CAFFEINATE_ARGS, detached: false };
  }
  if (platform === "linux") {
    return { binary: SYSTEMD_INHIBIT_BINARY, args: SYSTEMD_INHIBIT_ARGS, detached: true };
  }
  return null;
};

// Whether the host can keep itself awake. macOS ships `caffeinate` everywhere;
// Linux is supported only where `systemd-inhibit` is on PATH (every mainstream
// systemd distro — absent on non-systemd or minimal images, where the coffee
// button stays hidden instead of spawning a no-op). Parameterized for tests.
// Returns just a boolean, not the resolved path, because the controller only
// gates on capability; the spawn itself re-resolves on PATH at call time.
export const detectCaffeinateSupported = (
  platform: NodeJS.Platform = process.platform,
  envPath: string = process.env.PATH ?? "",
): boolean => {
  if (platform === "darwin") return true;
  if (platform === "linux") return findBinaryOnPath(SYSTEMD_INHIBIT_BINARY, envPath) !== null;
  return false;
};

const spawnKeepAwakeProcess = (): CaffeinateProcessHandle => {
  const target = keepAwakeSpawnTarget();
  if (target === null) {
    // Unsupported platform: emit an error on the next tick so onExit fires and
    // the controller records the spawn as never-held rather than wedging.
    const handle: CaffeinateProcessHandle = {
      kill: () => {},
      onExit: (listener) => {
        process.nextTick(() => listener());
      },
    };
    return handle;
  }
  const child = spawn(target.binary, [...target.args], {
    stdio: "ignore",
    detached: target.detached,
  });
  return {
    kill: () => {
      if (target.detached && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
          return;
        } catch {
          // Group already gone (process exited between spawn and kill); fall
          // through to a direct kill of the (now likely-dead) parent.
        }
      }
      child.kill();
    },
    onExit: (listener) => {
      // Both events mean "no longer keeping awake": `error` covers a failed
      // spawn (binary missing, e.g. systemd-inhibit absent on a non-systemd
      // host masquerading as supported) and `exit` a normal/killed termination.
      child.once("exit", listener);
      child.once("error", listener);
    },
  };
};

// The default keep-awake spawn strategy: `caffeinate -dims` on macOS,
// `systemd-inhibit … tail -f /dev/null` on Linux. Injected by tests that never
// want to hold a real power assertion.
export const defaultCaffeinateSpawn = (): CaffeinateProcessHandle => spawnKeepAwakeProcess();
