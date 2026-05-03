import { openSync } from "node:fs";
import { isLoopbackHost } from "localterm-server";
import kleur from "kleur";
import {
  DAEMON_PROBE_INTERVAL_MS,
  DAEMON_PROBE_MAX_WAIT_MS,
  EXIT_FAILURE,
  EXIT_USAGE_ERROR,
} from "../constants.js";
import { ensureLogFile, isAlive, readPort } from "../state.js";
import { buildDaemonStartArgs } from "../utils/build-daemon-args.js";
import { pollForDaemonReady } from "../utils/poll-for-daemon-ready.js";
import { sleep } from "../utils/sleep.js";
import { spawnDaemon } from "../utils/spawn-daemon.js";
import { runStop } from "./stop.js";

export interface RestartOptions {
  port: number;
  host: string;
  open: boolean;
}

export const runRestart = async (options: RestartOptions): Promise<void> => {
  if (!isLoopbackHost(options.host)) {
    console.log(
      kleur.red(
        `refusing to restart on '${options.host}'. localterm only accepts loopback hosts (127.0.0.1, localhost, *.localhost, ::1).`,
      ),
    );
    process.exit(EXIT_USAGE_ERROR);
  }
  await runStop();
  const portBeforeSpawn = readPort();
  const logPath = ensureLogFile();
  const logFd = openSync(logPath, "a");
  const { pid: childPid } = spawnDaemon({
    args: buildDaemonStartArgs(options),
    logFd,
  });

  if (childPid === undefined) {
    console.log(kleur.red(`✗ failed to spawn daemon process. tail logs: ${logPath}`));
    process.exit(EXIT_FAILURE);
  }

  const result = await pollForDaemonReady({
    childPid,
    initialPort: portBeforeSpawn,
    intervalMs: DAEMON_PROBE_INTERVAL_MS,
    maxWaitMs: DAEMON_PROBE_MAX_WAIT_MS,
    isAlive,
    readPort,
    sleep,
  });

  if (result.outcome === "ready") {
    console.log(
      kleur.green(`✔ restarted (pid ${childPid}, port ${result.port}, logs: ${logPath})`),
    );
    return;
  }
  if (result.outcome === "died") {
    console.log(kleur.red(`✗ daemon died during startup. tail logs: ${kleur.dim(logPath)}`));
    process.exit(EXIT_FAILURE);
  }
  console.log(
    kleur.yellow(
      `restart spawned (pid ${childPid}) but didn't write a fresh port file within ${DAEMON_PROBE_MAX_WAIT_MS}ms. tail logs: ${kleur.dim(logPath)}`,
    ),
  );
  process.exit(EXIT_FAILURE);
};
