import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { DAEMON_PROCESS_TITLE, VERIFY_PID_TIMEOUT_MS } from "../constants.js";

const execFileAsync = promisify(execFile);

const readProcessComm = async (pid: number): Promise<string | null> => {
  if (process.platform === "linux") {
    try {
      return (await readFile(`/proc/${pid}/comm`, "utf8")).trim();
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("ps", ["-o", "comm=", "-p", String(pid)], {
        timeout: VERIFY_PID_TIMEOUT_MS,
        windowsHide: true,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }
  return null;
};

export type PidVerification = "ours" | "not-ours" | "unknown";

export const verifyPidIsLocalterm = async (pid: number): Promise<PidVerification> => {
  if (!Number.isInteger(pid) || pid <= 0) return "not-ours";
  const comm = await readProcessComm(pid);
  if (comm === null) return "unknown";
  return comm === DAEMON_PROCESS_TITLE ? "ours" : "not-ours";
};
