import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SYSTEMD_USER_UNIT_NAME } from "../constants.js";

const execFileAsync = promisify(execFile);

// `systemctl --user is-active --quiet` exits 0 only when the unit is active, so
// a missing systemctl, an absent user session bus, or any non-active state
// (inactive/failed/activating) all fold to false — the restart/stop callers
// then fall back to the PID-based manual path, mirroring the launchd branch.
export const isSystemdUserServiceActive = async (): Promise<boolean> => {
  try {
    await execFileAsync("systemctl", ["--user", "is-active", "--quiet", SYSTEMD_USER_UNIT_NAME], {
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
};
