import os from "node:os";
import path from "node:path";
import {
  LAUNCHD_PLIST_FILENAME,
  MACOS_DAEMON_APP_DIRECTORY_NAME,
  MACOS_DAEMON_APP_EXECUTABLE_NAME,
  SYSTEMD_USER_UNIT_NAME,
} from "./constants.js";

export const getStateDirectory = (): string => path.join(os.homedir(), ".localterm");
export const getPidFile = (): string => path.join(getStateDirectory(), "server.pid");
export const getPortFile = (): string => path.join(getStateDirectory(), "server.port");
export const getHostFile = (): string => path.join(getStateDirectory(), "server.host");
export const getLogFile = (): string => path.join(getStateDirectory(), "server.log");
export const getCommandSpecFile = (): string => path.join(getStateDirectory(), "command-spec.json");
export const getLaunchdPlistPath = (): string =>
  path.join(os.homedir(), "Library", "LaunchAgents", LAUNCHD_PLIST_FILENAME);
export const getMacosDaemonAppPath = (): string =>
  path.join(getStateDirectory(), MACOS_DAEMON_APP_DIRECTORY_NAME);
export const getMacosDaemonExecutablePath = (appPath = getMacosDaemonAppPath()): string =>
  path.join(appPath, "Contents", "MacOS", MACOS_DAEMON_APP_EXECUTABLE_NAME);
export const getSystemdUserUnitDir = (): string =>
  path.join(os.homedir(), ".config", "systemd", "user");
export const getSystemdUserUnitPath = (): string =>
  path.join(getSystemdUserUnitDir(), SYSTEMD_USER_UNIT_NAME);
