import kleur from "kleur";
import { createApiClient } from "../api-client.js";
import { isAlive, readPid, readPort } from "../state.js";

export const runKill = async (id: string): Promise<void> => {
  const pid = readPid();
  const port = readPort();
  if (!pid || !port || !isAlive(pid)) {
    console.log(kleur.dim("localterm is not running."));
    return;
  }
  const client = createApiClient(port);
  const removed = await client.remove(id);
  if (removed) {
    console.log(kleur.green(`✔ killed ${id}`));
  } else {
    console.log(kleur.yellow(`session ${id} not found.`));
  }
};
