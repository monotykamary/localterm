import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireCjs = createRequire(import.meta.url);

export const resolveNodePtyDirectory = (): string => {
  const bundled = fileURLToPath(new URL("../../vendor/node-pty/", import.meta.url));
  // Registry installs cannot inherit the monorepo's Bun patch. macOS releases
  // ship their patched backend; Linux and unprepared worktrees use node-pty.
  if (process.platform === "darwin" && existsSync(path.join(bundled, "package.json"))) {
    return bundled;
  }
  return path.dirname(requireCjs.resolve("node-pty/package.json"));
};
