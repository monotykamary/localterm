import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LAUNCHD_LABEL } from "../constants.js";

const execFileAsync = promisify(execFile);

export const isLaunchdServiceLoaded = async (): Promise<boolean> => {
  try {
    await execFileAsync(
      "launchctl",
      ["print", `gui/${process.getuid?.() ?? ""}/${LAUNCHD_LABEL}`],
      { timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
};
