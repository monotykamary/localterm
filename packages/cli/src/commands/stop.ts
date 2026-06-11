import kleur from "kleur";
import { STOP_MAX_WAIT_MS, STOP_POLL_INTERVAL_MS } from "../constants.js";
import { cliError, exitCodeForCliError } from "../errors.js";
import { clearPid, isAlive, readPid } from "../state.js";
import { reportCliError } from "../utils/report-cli-error.js";
import { sleep } from "../utils/sleep.js";
import { verifyPidIsLocalterm } from "../utils/verify-pid-is-localterm.js";

export const runStop = async (): Promise<void> => {
  const pid = readPid();
  if (!pid) {
    console.log(kleur.dim("localterm is not running."));
    return;
  }
  if (!isAlive(pid)) {
    clearPid();
    console.log(kleur.dim("stale pid file removed."));
    return;
  }
  const verification = await verifyPidIsLocalterm(pid);
  if (verification === "not-ours") {
    const notOursError = cliError.pidNotOurs(pid);
    reportCliError(notOursError);
    process.exitCode = exitCodeForCliError(notOursError);
    clearPid();
    return;
  }
  if (verification === "unknown") {
    console.warn(
      kleur.yellow(
        `⚠ could not verify pid ${pid} — refusing to signal it. run 'kill ${pid}' manually if needed.`,
      ),
    );
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const signalError = cliError.signalFailed(
      pid,
      error instanceof Error ? error : new Error(String(error)),
    );
    reportCliError(signalError);
    process.exitCode = exitCodeForCliError(signalError);
    return;
  }

  let waited = 0;
  while (isAlive(pid) && waited < STOP_MAX_WAIT_MS) {
    await sleep(STOP_POLL_INTERVAL_MS);
    waited += STOP_POLL_INTERVAL_MS;
  }

  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* process exited between SIGTERM and SIGKILL */
    }
    let killWaited = 0;
    while (isAlive(pid) && killWaited < STOP_MAX_WAIT_MS) {
      await sleep(STOP_POLL_INTERVAL_MS);
      killWaited += STOP_POLL_INTERVAL_MS;
    }
  }
  if (isAlive(pid)) {
    console.warn(kleur.yellow(`pid ${pid} did not exit after SIGKILL`));
  }
  clearPid();
  console.log(kleur.green(`✔ stopped pid ${pid}`));
};
