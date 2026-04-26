import path from "node:path";
import kleur from "kleur";
import open from "open";
import { createApiClient } from "../api-client.js";
import { isAlive, readPid, readPort } from "../state.js";

export interface NewOptions {
  cwd?: string;
  shell?: string;
  open: boolean;
}

export const runNew = async (options: NewOptions): Promise<void> => {
  const pid = readPid();
  const port = readPort();
  if (!pid || !port || !isAlive(pid)) {
    console.log(kleur.yellow("localterm is not running. start it with 'localterm start'."));
    return;
  }
  const client = createApiClient(port);
  const session = await client.create({
    cwd: options.cwd ? path.resolve(options.cwd) : undefined,
    shell: options.shell,
  });
  console.log(kleur.green(`✔ created session ${kleur.bold(session.id)}`));
  if (options.open) {
    try {
      await open(`http://127.0.0.1:${port}/?tab=${session.id}`);
    } catch {
      /* headless environments (CI, ssh) have no browser to open; not fatal */
    }
  }
};
