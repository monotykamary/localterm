import { execFileSync } from "node:child_process";
import { globSync } from "node:fs";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "bin",
  "coverage",
]);

const files = globSync("{apps,packages}/**/*.{ts,tsx}", {
  exclude: (path) => {
    if (path.endsWith(".d.ts")) return true;
    const parts = path.split("/");
    return parts.some((part) => EXCLUDED_DIRS.has(part));
  },
});

if (files.length === 0) {
  console.log("No TypeScript files to lint.");
  process.exit(0);
}

const extraArgs = process.argv.slice(2).filter((arg) => arg === "--fix");

try {
  execFileSync("vp", ["lint", ...extraArgs, ...files], { stdio: "inherit" });
} catch (error) {
  process.exit(error.status ?? 1);
}
