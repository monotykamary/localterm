import { accessSync, constants as fsConstants } from "node:fs";
import os from "node:os";
import { DEFAULT_SHELL_FALLBACK } from "./constants.js";

const isExecutable = (binaryPath: string): boolean => {
  try {
    accessSync(binaryPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const getDefaultShell = (): string => {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "cmd.exe";
  }
  const candidates: string[] = [];
  if (process.env.SHELL) candidates.push(process.env.SHELL);
  try {
    const userInfo = os.userInfo();
    if (userInfo.shell) candidates.push(userInfo.shell);
  } catch {
    /* os.userInfo throws on systems without /etc/passwd entry for the uid */
  }
  candidates.push(DEFAULT_SHELL_FALLBACK);
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }
  return DEFAULT_SHELL_FALLBACK;
};
