import os from "node:os";
import path from "node:path";
import { LAUNCHD_PLIST_FILENAME } from "./constants.js";

export const getStateDirectory = (): string => path.join(os.homedir(), ".localterm");
export const getPidFile = (): string => path.join(getStateDirectory(), "server.pid");
export const getPortFile = (): string => path.join(getStateDirectory(), "server.port");
export const getHostFile = (): string => path.join(getStateDirectory(), "server.host");
export const getLogFile = (): string => path.join(getStateDirectory(), "server.log");
export const getLaunchdPlistPath = (): string =>
  path.join(os.homedir(), "Library", "LaunchAgents", LAUNCHD_PLIST_FILENAME);
