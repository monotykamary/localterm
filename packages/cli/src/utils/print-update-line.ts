import kleur from "kleur";
import type { UpdateStatus } from "@monotykamary/localterm-server";
import { readUpdateStatus, resolveApiHost } from "./read-update-status.js";

// Formats the banner update line, or null when there's nothing to show (no
// update available, or the fetch failed — a missing line is always safe).
export const formatUpdateLine = (status: UpdateStatus | null): string | null => {
  if (!status?.updateAvailable || !status.latest) return null;
  return kleur.yellow(
    `  update:  ${status.latest} available (run ${kleur.bold("`localterm update`")})`,
  );
};

// Fetches the daemon's update status and prints the banner line when an update
// is available. `wait` requests the server's blocking fresh path for
// `localterm start`; `localterm status` passes false to read the daemon's
// non-blocking cache and stay snappy.
export const printUpdateAvailableLine = async (
  host: string,
  port: number,
  wait: boolean,
): Promise<void> => {
  const status = await readUpdateStatus(resolveApiHost(host), port, wait);
  const line = formatUpdateLine(status);
  if (line) console.log(line);
};
