import { type CliError, cliError } from "../errors.js";
import { clearPid, isAlive, readPid, readPort } from "../state.js";

export const runStartPreflight = (): CliError | null => {
  const existingPid = readPid();
  if (existingPid && isAlive(existingPid)) {
    const existingPort = readPort();
    if (existingPort === null) {
      return cliError.stalePortFile(existingPid);
    }
    return cliError.alreadyRunning(existingPid, existingPort);
  }
  if (existingPid) clearPid();
  return null;
};
