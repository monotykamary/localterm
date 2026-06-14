import { openSync } from "node:fs";
import kleur from "kleur";
import { DAEMON_PROBE_INTERVAL_MS, DAEMON_PROBE_MAX_WAIT_MS } from "../constants.js";
import { cliError, exitCodeForCliError } from "../errors.js";
import { ensureLogFile, isAlive, readHost, readPid, readPort } from "../state.js";
import { buildDaemonStartArgs } from "../utils/build-daemon-args.js";
import { pollForDaemonReady } from "../utils/poll-for-daemon-ready.js";
import { reportCliError } from "../utils/report-cli-error.js";
import { sleep } from "../utils/sleep.js";
import { spawnDaemon } from "../utils/spawn-daemon.js";
import { verifyPidIsLocalterm } from "../utils/verify-pid-is-localterm.js";

export interface RestartOptions {
  port: number;
  host: string;
  open: boolean;
}

const terminateOldDaemon = async (oldPid: number): Promise<void> => {
  if (!isAlive(oldPid)) return;

  const verification = await verifyPidIsLocalterm(oldPid);
  if (verification === "not-ours") return;

  try {
    process.kill(oldPid, "SIGTERM");
  } catch {
    // Process exited between isAlive and SIGTERM
    return;
  }

  let waited = 0;
  while (isAlive(oldPid) && waited < 5000) {
    await sleep(100);
    waited += 100;
  }

  if (isAlive(oldPid)) {
    try {
      process.kill(oldPid, "SIGKILL");
    } catch {
      // Process exited between checks
    }
  }
};

export const runRestart = async (options: RestartOptions): Promise<void> => {
  const oldPid = readPid();
  const portBeforeSpawn = readPort();

  const logPath = ensureLogFile();
  const logFd = openSync(logPath, "a");
  const { pid: childPid } = spawnDaemon({
    args: buildDaemonStartArgs(options),
    logFd,
  });

  if (childPid === undefined) {
    const error = cliError.daemonSpawnFailed(process.execPath, logPath);
    reportCliError(error);
    process.exit(exitCodeForCliError(error));
  }

  const result = await pollForDaemonReady({
    childPid,
    initialPort: portBeforeSpawn,
    intervalMs: DAEMON_PROBE_INTERVAL_MS,
    maxWaitMs: DAEMON_PROBE_MAX_WAIT_MS,
    logPath,
    isAlive,
    readPort,
    readHost,
    readPid,
    sleep,
  });

  if (!result.ok) {
    reportCliError(result.error);
    process.exit(exitCodeForCliError(result.error));
    return;
  }

  if (oldPid !== null && oldPid !== childPid) {
    await terminateOldDaemon(oldPid);
  }

  console.log(kleur.green(`✔ restarted (pid ${childPid}, port ${result.port}, logs: ${logPath})`));
};
