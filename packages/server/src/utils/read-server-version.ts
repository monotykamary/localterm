import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const packageJsonSchema = z.object({ version: z.string().min(1) });

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(moduleDir, "../../package.json");

// Reads the daemon's own published version from package.json. The CLI passes
// its version into `createServer({ currentVersion })` so the update check
// compares against the package the user actually installed (the CLI
// `@monotykamary/localterm`); this fallback covers embedders/tests that don't,
// reading the server package instead (it ships in lockstep with the CLI).
export const readServerVersion = (): string => {
  const parsed = packageJsonSchema.parse(JSON.parse(readFileSync(packageJsonPath, "utf8")));
  return parsed.version;
};
