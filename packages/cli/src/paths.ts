import os from "node:os";
import path from "node:path";

export const getStateDirectory = (): string => path.join(os.homedir(), ".localterm");
export const getPidFile = (): string => path.join(getStateDirectory(), "server.pid");
export const getPortFile = (): string => path.join(getStateDirectory(), "server.port");
export const getHostFile = (): string => path.join(getStateDirectory(), "server.host");
export const getLogFile = (): string => path.join(getStateDirectory(), "server.log");
