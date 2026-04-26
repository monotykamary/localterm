import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CWD_RESOLVE_TIMEOUT_MS = 250;

const parseLsofPathOutput = (stdout: string): string | null => {
  const lines = stdout.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === "fcwd") {
      const next = lines[index + 1];
      if (next && next.startsWith("n")) return next.slice(1);
    }
  }
  return null;
};

export const resolveCwdForPid = async (pid: number): Promise<string | null> => {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const target = await readlink(`/proc/${pid}/cwd`);
      return target || null;
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin" || process.platform === "freebsd") {
    try {
      const { stdout } = await execFileAsync(
        "lsof",
        ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
        { timeout: CWD_RESOLVE_TIMEOUT_MS, windowsHide: true },
      );
      return parseLsofPathOutput(stdout);
    } catch {
      return null;
    }
  }
  return null;
};
