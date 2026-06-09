import kleur from "kleur";
import { healthSchema } from "@monotykamary/localterm-server";
import { getFriendlyUrl } from "../constants.js";
import { cliError } from "../errors.js";
import { isAlive, readPid, readPort } from "../state.js";
import { reportCliError } from "../utils/report-cli-error.js";

export const runStatus = async (): Promise<void> => {
  const pid = readPid();
  const port = readPort();

  if (!pid || !port) {
    console.log(kleur.dim("localterm is not running."));
    return;
  }
  if (!isAlive(pid)) {
    console.log(kleur.yellow(`pid ${pid} is gone (stale state). run 'localterm start'.`));
    return;
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!response.ok) throw new Error(`health check failed: ${response.status}`);
    const health = healthSchema.parse(await response.json());
    console.log(kleur.green("● running"));
    console.log(`  pid:      ${pid}`);
    console.log(`  port:     ${port}`);
    console.log(`  url:      ${kleur.cyan(getFriendlyUrl(port))}`);
    console.log(`  raw:      ${kleur.dim(`http://127.0.0.1:${port}`)}`);
    console.log(`  sessions: ${health.sessions}`);
  } catch (error) {
    reportCliError(
      cliError.healthCheckFailed(
        pid,
        port,
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  }
};
