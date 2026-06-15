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

const clearQuarantineAndResign = (target) => {
  if (process.platform !== "darwin") return;
  try {
    const stat = statSync(target);
    if (!(stat.mode & 0o111)) return;
  } catch {
    return;
  }
  try {
    execSync(`xattr -d com.apple.quarantine ${JSON.stringify(target)}`, {
      timeout: 5_000,
      stdio: "ignore",
    });
  } catch {
    /* xattr not present or already cleared */
  }
  try {
    execSync(`codesign --force --sign - ${JSON.stringify(target)}`, {
      timeout: 10_000,
      stdio: "ignore",
    });
  } catch {
    /* codesign unavailable or binary already signed */
  }
};

for (const candidate of candidates) {
  if (!existsSync(candidate)) continue;
  try {
    chmodSync(candidate, 0o755);
  } catch (error) {
    console.warn(
      `[fix-node-pty] could not chmod ${candidate}: ${error instanceof Error ? error.message : error}`,
    );
  }
  clearQuarantineAndResign(candidate);
}
