import os from "node:os";
import path from "node:path";
import { TITLE_MAX_PATH_SEGMENTS, TITLE_TRUNCATION_PREFIX } from "../constants.js";

const HOME_PREFIX = "~";
const PATH_SEPARATOR = "/";
const CACHED_HOME_DIRECTORY = os.homedir();

const abbreviateHome = (cwd: string, home: string): string => {
  const normalizedCwd = path.resolve(cwd);
  const normalizedHome = path.resolve(home);
  if (normalizedCwd === normalizedHome) return HOME_PREFIX;
  if (normalizedCwd.startsWith(`${normalizedHome}${PATH_SEPARATOR}`)) {
    return `${HOME_PREFIX}${normalizedCwd.slice(normalizedHome.length)}`;
  }
  return normalizedCwd;
};

export const formatWorkingDirectoryTitle = (cwd: string, home = CACHED_HOME_DIRECTORY): string => {
  if (!cwd) return cwd;
  const abbreviated = abbreviateHome(cwd, home);
  const segments = abbreviated.split(PATH_SEPARATOR).filter(Boolean);
  if (segments.length <= TITLE_MAX_PATH_SEGMENTS) return abbreviated;
  return `${TITLE_TRUNCATION_PREFIX}${PATH_SEPARATOR}${segments
    .slice(-TITLE_MAX_PATH_SEGMENTS)
    .join(PATH_SEPARATOR)}`;
};
