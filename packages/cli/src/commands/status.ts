import kleur from "kleur";
import { createApiClient } from "../api-client.js";
import { isAlive, readPid, readPort } from "../state.js";

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

  const client = createApiClient(port);
  try {
    const health = await client.health();
    console.log(kleur.green("● running"));
    console.log(`  pid:      ${pid}`);
    console.log(`  port:     ${port}`);
    console.log(`  url:      ${kleur.cyan(`http://127.0.0.1:${port}`)}`);
    console.log(`  sessions: ${health.sessions}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(kleur.yellow(`pid ${pid} is alive but health check failed: ${message}`));
  }
};
