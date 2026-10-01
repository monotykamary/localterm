import { createRequire } from "node:module";
import type { spawn } from "node-pty";
import { resolveNodePtyDirectory } from "./utils/resolve-node-pty-directory.js";

const requireCjs = createRequire(import.meta.url);

export const spawnPty: typeof spawn = (...args) => {
  const backend = requireCjs(resolveNodePtyDirectory()) as typeof import("node-pty");
  return backend.spawn(...args);
};
