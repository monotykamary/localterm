#!/usr/bin/env node
import { chmodSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const requireCjs = createRequire(import.meta.url);

let nodePtyDir;
try {
  const serverPackageJson = requireCjs.resolve("@monotykamary/localterm-server/package.json");
  const ptyEntry = requireCjs.resolve("node-pty", { paths: [path.dirname(serverPackageJson)] });
  nodePtyDir = path.dirname(path.dirname(ptyEntry));
} catch {
  console.log("[fix-node-pty] node-pty not found, skipping");
  process.exit(0);
}

const candidates = [
  path.join(nodePtyDir, "build", "Release", "spawn-helper"),
  path.join(nodePtyDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
];

const isExecutable = (filePath) => {
  try {
    return Boolean(statSync(filePath).mode & 0o111);
  } catch {
    return false;
  }
};

const hasQuarantine = (target) => {
  if (process.platform !== "darwin") return false;
  try {
    execSync(`xattr -p com.apple.quarantine ${JSON.stringify(target)}`, {
      timeout: 5_000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
};

const clearQuarantine = (target) => {
  try {
    execSync(`xattr -d com.apple.quarantine ${JSON.stringify(target)}`, {
      timeout: 5_000,
      stdio: "ignore",
    });
  } catch {
    // xattr not present or already cleared
  }
};

const hasValidSignature = (target) => {
  if (process.platform !== "darwin") return true;
  try {
    execSync(`codesign --verify ${JSON.stringify(target)}`, {
      timeout: 10_000,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

const adHocSign = (target) => {
  try {
    execSync(`codesign --force --sign - ${JSON.stringify(target)}`, {
      timeout: 10_000,
      stdio: "ignore",
    });
  } catch {
    // codesign unavailable
  }
};

for (const candidate of candidates) {
  if (!existsSync(candidate)) continue;

  if (!isExecutable(candidate)) {
    try {
      chmodSync(candidate, 0o755);
    } catch (error) {
      console.warn(
        `[fix-node-pty] could not chmod ${candidate}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  if (hasQuarantine(candidate)) {
    clearQuarantine(candidate);
  }

  if (!hasValidSignature(candidate)) {
    adHocSign(candidate);
  }
}
