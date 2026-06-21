import kleur from "kleur";
import { healthSchema } from "@monotykamary/localterm-server";
import { getDirectUrl } from "../constants.js";
import { cliError, exitCodeForCliError } from "../errors.js";
import { clearPid, isAlive, readHost, readPid, readPort } from "../state.js";
import { resolveDaemonUrl } from "../utils/portless.js";
import { reportCliError } from "../utils/report-cli-error.js";

export const runStatus = async (): Promise<void> => {
  const pid = readPid();
  const port = readPort();

  if (!pid && !port) {
    console.log(kleur.dim("localterm is not running."));
    return;
  }
  if (!pid) {
    clearPid();
    console.log(kleur.dim("stale port file removed."));
    return;
  }
  if (!isAlive(pid)) {
    clearPid();
    console.log(kleur.yellow(`pid ${pid} is gone (stale state). run 'localterm start'.`));
    return;
  }
  if (!port) {
    console.log(
      kleur.yellow(
        `pid ${pid} is alive but port is unknown. run 'localterm stop' then 'localterm start'.`,
      ),
    );
    return;
  }

  const resolvedHost = readHost() ?? "127.0.0.1";
  try {
    const response = await fetch(`http://${resolvedHost}:${port}/api/health`);
    if (!response.ok) throw new Error(`health check failed: ${response.status}`);
    const health = healthSchema.parse(await response.json());
    console.log(kleur.green("● running"));
    console.log(`  pid:      ${pid}`);
    console.log(`  port:     ${port}`);
    const resolved = await resolveDaemonUrl(port);
    console.log(`  url:      ${kleur.cyan(resolved.url)}  ${kleur.dim(`(${resolved.surface})`)}`);
    for (const warning of resolved.warnings) {
      console.log(kleur.yellow(`  ⚠ ${warning}`));
    }
    console.log(`  raw:      ${kleur.dim(getDirectUrl(port, resolvedHost))}`);
    console.log(`  sessions: ${health.sessions}`);
  } catch (error) {
    const healthError = cliError.healthCheckFailed(
      pid,
      port,
      error instanceof Error ? error : new Error(String(error)),
    );
    reportCliError(healthError);
    process.exitCode = exitCodeForCliError(healthError);
  }
};
