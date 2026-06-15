import { chmodSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const requireCjs = createRequire(import.meta.url);
const SPAWN_HELPER_MODE = 0o755;

let alreadyEnsured = false;

const candidateSpawnHelperPaths = (nodePtyDir: string): string[] => [
  path.join(nodePtyDir, "build", "Release", "spawn-helper"),
  path.join(nodePtyDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
];

const candidateNativeAddonPaths = (nodePtyDir: string): string[] => [
  path.join(nodePtyDir, "build", "Release", "pty.node"),
  path.join(nodePtyDir, "prebuilds", `${process.platform}-${process.arch}`, "pty.node"),
];

const isExecutable = (filePath: string): boolean => {
  try {
    return Boolean(statSync(filePath).mode & 0o111);
  } catch {
    return false;
  }
};

const hasQuarantine = (target: string): boolean => {
  try {
    execFileSync("xattr", ["-p", "com.apple.quarantine", target], {
      timeout: 5_000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
};

const clearQuarantine = (target: string): void => {
  try {
    execFileSync("xattr", ["-d", "com.apple.quarantine", target], {
      timeout: 5_000,
      stdio: "ignore",
    });
  } catch {
    // xattr not present or quarantine already cleared
  }
};

const hasValidSignature = (target: string): boolean => {
  try {
    execFileSync("codesign", ["--verify", target], {
      timeout: 10_000,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

const adHocSign = (target: string): void => {
  try {
    execFileSync("codesign", ["--force", "--sign", "-", target], {
      timeout: 10_000,
      stdio: "ignore",
    });
  } catch {
    // codesign unavailable; the binary may still work if not quarantined
  }
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
  const allCandidates = [
    ...candidateSpawnHelperPaths(nodePtyDir),
    ...candidateNativeAddonPaths(nodePtyDir),
  ];
  for (const candidate of allCandidates) {
    if (!existsSync(candidate)) continue;

    if (!isExecutable(candidate)) {
      try {
        chmodSync(candidate, SPAWN_HELPER_MODE);
      } catch {
        // filesystem refused chmod (e.g. read-only mount)
      }
    }

    if (process.platform !== "darwin") continue;

    if (hasQuarantine(candidate)) {
      clearQuarantine(candidate);
    }

    if (!hasValidSignature(candidate)) {
      adHocSign(candidate);
    }
  }
};
