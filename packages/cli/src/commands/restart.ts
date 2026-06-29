import { execFile } from "node:child_process";
import { openSync } from "node:fs";
import { promisify } from "node:util";
import kleur from "kleur";
import {
  DAEMON_PROBE_INTERVAL_MS,
  DAEMON_PROBE_MAX_WAIT_MS,
  LAUNCHD_LABEL,
  SYSTEMD_USER_UNIT_NAME,
} from "../constants.js";
import { cliError, exitCodeForCliError } from "../errors.js";
import { ensureLogFile, isAlive, readHost, readPid, readPort } from "../state.js";
import { buildDaemonStartArgs } from "../utils/build-daemon-args.js";
import { isLaunchdServiceLoaded } from "../utils/is-launchd-service-loaded.js";
import { isSystemdUserServiceActive } from "../utils/is-systemd-service-active.js";
import { pollForDaemonReady } from "../utils/poll-for-daemon-ready.js";
import { announceResolvedUrl, resolveDaemonUrl } from "../utils/portless.js";
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

const pollRestartedDaemon = async (
  oldPid: number,
  logPath: string,
  label: string,
): Promise<void> => {
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
          kleur.green(`✔ restarted via ${label} (pid ${pid}, port ${port}, logs: ${logPath})`),
        );
        const resolved = await resolveDaemonUrl(port);
        announceResolvedUrl(resolved.url, resolved.surface);
        for (const warning of resolved.warnings) {
          console.log(kleur.yellow(`  ⚠ ${warning}`));
        }
        return;
      }
    } catch {
      // health probe failed; keep polling
    }
  }

  const timeoutError = cliError.daemonReadyTimeout(oldPid, DAEMON_PROBE_MAX_WAIT_MS, logPath);
  reportCliError(timeoutError);
  process.exit(exitCodeForCliError(timeoutError));
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

  await pollRestartedDaemon(oldPid ?? 0, logPath, "launchd");
};

const restartViaSystemd = async (_options: RestartOptions): Promise<void> => {
  const oldPid = readPid();
  const logPath = ensureLogFile();

  try {
    await execFileAsync("systemctl", ["--user", "restart", SYSTEMD_USER_UNIT_NAME], {
      timeout: 10_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const startError = cliError.serverStartFailed(
      new Error(`systemctl --user restart failed: ${message}`),
    );
    reportCliError(startError);
    process.exit(exitCodeForCliError(startError));
    return;
  }

  await pollRestartedDaemon(oldPid ?? 0, logPath, "systemd");
};

export const runRestart = async (options: RestartOptions): Promise<void> => {
  if (process.platform === "darwin" && (await isLaunchdServiceLoaded())) {
    await restartViaLaunchd(options);
    return;
  }
  if (process.platform === "linux" && (await isSystemdUserServiceActive())) {
    await restartViaSystemd(options);
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
  const resolved = await resolveDaemonUrl(result.port);
  announceResolvedUrl(resolved.url, resolved.surface);
  for (const warning of resolved.warnings) {
    console.log(kleur.yellow(`  ⚠ ${warning}`));
  }
};
