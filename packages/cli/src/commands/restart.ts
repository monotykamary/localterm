import { execFile } from "node:child_process";
import { openSync } from "node:fs";
import { promisify } from "node:util";
import kleur from "kleur";
import { DAEMON_PROBE_INTERVAL_MS, DAEMON_PROBE_MAX_WAIT_MS, LAUNCHD_LABEL } from "../constants.js";
import { cliError, exitCodeForCliError } from "../errors.js";
import { ensureLogFile, isAlive, readHost, readPid, readPort } from "../state.js";
import { buildDaemonStartArgs } from "../utils/build-daemon-args.js";
import { isLaunchdServiceLoaded } from "../utils/is-launchd-service-loaded.js";
import { pollForDaemonReady } from "../utils/poll-for-daemon-ready.js";
import { reportCliError } from "../utils/report-cli-error.js";
import { sleep } from "../utils/sleep.js";
import { spawnDaemon } from "../utils/spawn-daemon.js";
import { verifyPidIsLocalterm } from "../utils/verify-pid-is-localterm.js";

const execFileAsync = promisify(execFile);

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

const restartViaLaunchd = async (_options: RestartOptions): Promise<void> => {
  const oldPid = readPid();
  const logPath = ensureLogFile();
  const serviceTarget = `gui/${process.getuid?.() ?? ""}/${LAUNCHD_LABEL}`;

  try {
    await execFileAsync("launchctl", ["kickstart", "-k", serviceTarget], {
      timeout: 10_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const startError = cliError.serverStartFailed(
      new Error(`launchctl kickstart failed: ${message}`),
    );
    reportCliError(startError);
    process.exit(exitCodeForCliError(startError));
    return;
  }

  let waited = 0;
  while (waited < DAEMON_PROBE_MAX_WAIT_MS) {
    await sleep(DAEMON_PROBE_INTERVAL_MS);
    waited += DAEMON_PROBE_INTERVAL_MS;

    const pid = readPid();
    const port = readPort();
    if (pid === null || port === null) continue;
    if (pid === oldPid && isAlive(oldPid)) continue;
    if (!isAlive(pid)) continue;

    try {
      const host = readHost() ?? "127.0.0.1";
      const response = await fetch(`http://${host}:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        console.log(
          kleur.green(`✔ restarted via launchd (pid ${pid}, port ${port}, logs: ${logPath})`),
        );
        return;
      }
    } catch {
      // health probe failed; keep polling
    }
  }

  const timeoutError = cliError.daemonReadyTimeout(oldPid ?? 0, DAEMON_PROBE_MAX_WAIT_MS, logPath);
  reportCliError(timeoutError);
  process.exit(exitCodeForCliError(timeoutError));
};

export const runRestart = async (options: RestartOptions): Promise<void> => {
  if (process.platform === "darwin" && (await isLaunchdServiceLoaded())) {
    await restartViaLaunchd(options);
    return;
  }

  const oldPid = readPid();
  const portBeforeSpawn = readPort();

  const logPath = ensureLogFile();
  const logFd = openSync(logPath, "a");
  const { pid: childPid } = spawnDaemon({
    args: buildDaemonStartArgs(options),
    logFd,
    restart: true,
  });

  if (childPid === undefined) {
    const error = cliError.daemonSpawnFailed(process.execPath, logPath);
    reportCliError(error);
    process.exit(exitCodeForCliError(error));
  }

  if (oldPid !== null && oldPid !== childPid) {
    await terminateOldDaemon(oldPid);
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

  console.log(kleur.green(`✔ restarted (pid ${childPid}, port ${result.port}, logs: ${logPath})`));
};
