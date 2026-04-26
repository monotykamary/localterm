#!/usr/bin/env node
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const requireCjs = createRequire(import.meta.url);

let nodePtyDir;
try {
  const ptyEntry = requireCjs.resolve("node-pty");
  nodePtyDir = path.dirname(path.dirname(ptyEntry));
} catch {
  process.exit(0);
}

const candidates = [
  path.join(nodePtyDir, "build", "Release", "spawn-helper"),
  path.join(nodePtyDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
];

for (const candidate of candidates) {
  if (!existsSync(candidate)) continue;
  try {
    chmodSync(candidate, 0o755);
  } catch (error) {
    console.warn(
      `[fix-node-pty] could not chmod ${candidate}: ${error instanceof Error ? error.message : error}`,
    );
  }
}
