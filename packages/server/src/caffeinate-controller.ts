import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { CAFFEINATE_ARGS, CAFFEINATE_BINARY } from "./constants.js";

// A spawned keep-awake process. The controller only needs to end it and learn
// when it dies (on its own, or because we killed it).
export interface CaffeinateProcessHandle {
  kill: () => void;
  onExit: (listener: () => void) => void;
}

export interface CaffeinateControllerOptions {
  // Whether the platform can keep itself awake. Defaults to macOS detection;
  // injectable so non-darwin hosts and tests can declare (un)support directly.
  supported?: boolean;
  // Spawns the keep-awake process. Injectable so tests never hold a real power
  // assertion. Defaults to `caffeinate -dims`.
  spawnProcess?: () => CaffeinateProcessHandle;
}

interface CaffeinateControllerEvents {
  change: [];
}

const spawnCaffeinate = (): CaffeinateProcessHandle => {
  const child = spawn(CAFFEINATE_BINARY, CAFFEINATE_ARGS, { stdio: "ignore" });
  return {
    kill: () => {
      child.kill();
    },
    // Both events mean "no longer keeping awake": `error` covers a failed spawn
    // (e.g. caffeinate missing), `exit` covers a normal/killed termination.
    onExit: (listener) => {
      child.once("exit", listener);
      child.once("error", listener);
    },
  };
};

// Owns the machine's single keep-awake process. Enabling spawns it; disabling
// kills it. Emits `change` whenever `active` flips — including when the process
// dies unexpectedly — so callers can rebroadcast the authoritative state.
export class CaffeinateController extends EventEmitter<CaffeinateControllerEvents> {
  readonly supported: boolean;
  private readonly spawnProcess: () => CaffeinateProcessHandle;
  private handle: CaffeinateProcessHandle | null = null;

  constructor(options: CaffeinateControllerOptions = {}) {
    super();
    this.supported = options.supported ?? process.platform === "darwin";
    this.spawnProcess = options.spawnProcess ?? spawnCaffeinate;
  }

  get active(): boolean {
    return this.handle !== null;
  }

  setActive(enabled: boolean): void {
    if (!this.supported) return;
    if (enabled) this.start();
    else this.stop();
  }

  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  private start(): void {
    if (this.handle) return;
    const handle = this.spawnProcess();
    this.handle = handle;
    handle.onExit(() => {
      // Ignore the exit of a process we already replaced or intentionally
      // stopped; only an unexpected death of the current handle flips state.
      if (this.handle !== handle) return;
      this.handle = null;
      this.emit("change");
    });
    this.emit("change");
  }

  private stop(): void {
    if (!this.handle) return;
    const handle = this.handle;
    this.handle = null;
    handle.kill();
    this.emit("change");
  }
}
