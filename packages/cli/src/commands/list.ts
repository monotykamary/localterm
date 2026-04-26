import kleur from "kleur";
import { createApiClient } from "../api-client.js";
import { isAlive, readPid, readPort } from "../state.js";

export const runList = async (): Promise<void> => {
  const pid = readPid();
  const port = readPort();
  if (!pid || !port || !isAlive(pid)) {
    console.log(kleur.dim("localterm is not running."));
    return;
  }
  const client = createApiClient(port);
  const sessions = await client.list();
  if (sessions.length === 0) {
    console.log(kleur.dim("no active sessions."));
    return;
  }
  for (const session of sessions) {
    const status = session.exited ? kleur.red("exited") : kleur.green("alive");
    console.log(
      `${kleur.bold(session.id)}  ${status}  ${session.title}  ${kleur.dim(session.cwd)}`,
    );
  }
};
