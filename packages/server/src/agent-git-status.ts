import { spawnSync } from "node:child_process";
import { MAX_AUTOMATION_CHANGED_FILES } from "./constants.js";

const parseGitStatus = (output: string): Set<string> => {
  const set = new Set<string>();
  for (const line of output.split("\n")) {
    if (line.length < 3) continue;
    let filePath = line.slice(3);
    const arrow = filePath.indexOf(" -> ");
    if (arrow !== -1) filePath = filePath.slice(arrow + 4);
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }
    if (filePath.length > 0) set.add(filePath);
  }
  return set;
};

export const gitStatusSet = (cwd: string): Set<string> => {
  try {
    const result = spawnSync("git", ["-C", cwd, "status", "--porcelain"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.error || result.status !== 0) return new Set();
    return parseGitStatus(result.stdout);
  } catch {
    return new Set();
  }
};

export const computeChangedFiles = (before: Set<string>, cwd: string): string[] => {
  const after = gitStatusSet(cwd);
  const changed: string[] = [];
  for (const filePath of after) if (!before.has(filePath)) changed.push(filePath);
  for (const filePath of before) if (!after.has(filePath)) changed.push(filePath);
  changed.sort();
  return changed.slice(0, MAX_AUTOMATION_CHANGED_FILES);
};
