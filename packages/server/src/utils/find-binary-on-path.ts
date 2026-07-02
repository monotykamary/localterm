import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

// Walks PATH for an executable named `name`, returning the first absolute path
// that's executable or null when nothing matches. Sync because the keep-awake
// controller reads `supported` at construction (a handful of stat calls scoped
// to the few PATH dirs, microseconds) and the browser launcher calls it inside
// a best-effort async handler where brief sync fs is harmless. No shell-out to
// `which`/`command -v`, so it works without a POSIX shell on PATH.
export const findBinaryOnPath = (
  name: string,
  envPath: string = process.env.PATH ?? "",
): string | null => {
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
};
