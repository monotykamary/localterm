import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { getHostFile, getLogFile, getPidFile, getPortFile, getStateDirectory } from "./paths.js";

export const ensureStateDirectory = (): void => {
  const stateDirectory = getStateDirectory();
  if (!existsSync(stateDirectory)) {
    mkdirSync(stateDirectory, { recursive: true });
  }
};

export const ensureLogFile = (): string => {
  ensureStateDirectory();
  const logFile = getLogFile();
  if (!existsSync(logFile)) {
    writeFileSync(logFile, "", "utf8");
  }
  return logFile;
};

export const writePid = (pid: number, port: number, host: string): void => {
  ensureStateDirectory();
  const pidFile = getPidFile();
  const portFile = getPortFile();
  const hostFile = getHostFile();
  const pidTmp = `${pidFile}.tmp`;
  const portTmp = `${portFile}.tmp`;
  const hostTmp = `${hostFile}.tmp`;
  writeFileSync(pidTmp, String(pid), "utf8");
  writeFileSync(portTmp, String(port), "utf8");
  writeFileSync(hostTmp, host, "utf8");
  renameSync(pidTmp, pidFile);
  renameSync(portTmp, portFile);
  renameSync(hostTmp, hostFile);
};

export const clearPid = (): void => {
  for (const file of [getPidFile(), getPortFile(), getHostFile()]) {
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      /* file may have been removed by another process between existsSync and unlink */
    }
  }
};

export const readPid = (): number | null => {
  const pidFile = getPidFile();
  if (!existsSync(pidFile)) return null;
  const raw = readFileSync(pidFile, "utf8").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const readPort = (): number | null => {
  const portFile = getPortFile();
  if (!existsSync(portFile)) return null;
  const raw = readFileSync(portFile, "utf8").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const readHost = (): string | null => {
  const hostFile = getHostFile();
  if (!existsSync(hostFile)) return null;
  const raw = readFileSync(hostFile, "utf8").trim();
  return raw || null;
};

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      return true;
    }
    return false;
  }
};
