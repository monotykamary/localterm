import kleur from "kleur";
import { STOP_MAX_WAIT_MS, STOP_POLL_INTERVAL_MS } from "../constants.js";
import { clearPid, isAlive, readPid } from "../state.js";

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

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(kleur.red(`failed to signal pid ${pid}: ${message}`));
    return;
  }

  let waited = 0;
  while (isAlive(pid) && waited < STOP_MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_INTERVAL_MS));
    waited += STOP_POLL_INTERVAL_MS;
  }

  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* process exited between SIGTERM and SIGKILL */
    }
  }
  clearPid();
  console.log(kleur.green(`✔ stopped pid ${pid}`));
};
