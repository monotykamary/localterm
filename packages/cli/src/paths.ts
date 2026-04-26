import os from "node:os";
import path from "node:path";

export const stateDirectory = path.join(os.homedir(), ".localterm");
export const pidFile = path.join(stateDirectory, "server.pid");
export const portFile = path.join(stateDirectory, "server.port");
export const logFile = path.join(stateDirectory, "server.log");
