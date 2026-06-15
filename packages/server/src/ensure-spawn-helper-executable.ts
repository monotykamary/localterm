import { chmodSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const requireCjs = createRequire(import.meta.url);
const SPAWN_HELPER_MODE = 0o755;

let alreadyEnsured = false;

const candidateSpawnHelperPaths = (nodePtyDir: string): string[] => [
  path.join(nodePtyDir, "build", "Release", "spawn-helper"),
  path.join(nodePtyDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
];

const clearQuarantineAndResign = (target: string): void => {
  if (process.platform !== "darwin") return;
  execFile("xattr", ["-d", "com.apple.quarantine", target], { timeout: 5_000 }, () => {
    execFile("codesign", ["--force", "--sign", "-", target], { timeout: 10_000 }, () => {});
  });
};

export const ensureSpawnHelperExecutable = (): void => {
  if (alreadyEnsured) return;
  alreadyEnsured = true;
  let nodePtyDir: string;
  try {
    const ptyEntry = requireCjs.resolve("node-pty");
    nodePtyDir = path.dirname(path.dirname(ptyEntry));
  } catch {
    return;
  }
  for (const candidate of candidateSpawnHelperPaths(nodePtyDir)) {
    if (!existsSync(candidate)) continue;
    try {
      chmodSync(candidate, SPAWN_HELPER_MODE);
    } catch {
      /* helper already executable, or filesystem refused chmod (e.g. read-only mount) */
    }
    clearQuarantineAndResign(candidate);
  }
};
