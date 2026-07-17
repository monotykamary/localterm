import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Resolved `pi` binary + the PATH to spawn it with. The daemon process often
// has a minimal PATH (no ~/.npm-global/bin, etc.), so the first agent run
// resolves `pi` once — scanning PATH, then falling back to the user's login
// shell — and reuses it. The login PATH is also used as the spawn PATH (minus
// the shims dir) so pi and its tools find their dependencies; the daemon's own
// minimal PATH would leave pi unable to spawn node/git/etc. Only a successful
// resolution is cached (null re-resolves), so a later install is picked up.
export interface PiResolution {
  binary: string | null;
  pathEnv: string;
}
let cachedPi: PiResolution | undefined;

const pathWithoutShims = (pathVar: string, shimsDir: string): string =>
  pathVar
    .split(path.delimiter)
    .filter((dir) => dir.length > 0 && path.resolve(dir) !== path.resolve(shimsDir))
    .join(path.delimiter);

const scanPathForPi = (pathVar: string, shimsDir: string): string | null => {
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir.length === 0 || path.resolve(dir) === path.resolve(shimsDir)) continue;
    const candidate = path.join(dir, "pi");
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // not present or not executable in this dir
    }
  }
  return null;
};

// Fallback: the user's login interactive shell PATH, which sources the RC
// that adds pi's directory (e.g. ~/.npm-global/bin via ~/.zshrc). The localterm
// shims dir is typically first in the login PATH, so the caller scans the
// result minus the shims dir to land on the real binary, not the
// secret-injecting shim. The PATH is printed with delimiters to survive shell
// hooks like OSC-7 working-directory reports that write to stdout. stdin is
// empty so an interactive shell with `-c` runs the command and exits.
const resolveLoginPath = (): string => {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const result = spawnSync(
      shell,
      ["-l", "-i", "-c", "printf 'PIPATHBEGIN%sPIPATHEND' \"$PATH\""],
      {
        encoding: "utf8",
        input: "",
        timeout: 10_000,
      },
    );
    const stdout = result.stdout || "";
    const start = stdout.indexOf("PIPATHBEGIN");
    const end = stdout.indexOf("PIPATHEND", start === -1 ? 0 : start);
    if (start === -1 || end === -1) return "";
    return stdout.slice(start + "PIPATHBEGIN".length, end);
  } catch {
    return "";
  }
};

export const resolvePiAndPath = (shimsDir: string, override?: string): PiResolution => {
  if (override) return { binary: override, pathEnv: process.env.PATH ?? "" };
  if (cachedPi) return cachedPi;
  const daemonPath = process.env.PATH ?? "";
  const fromDaemon = scanPathForPi(daemonPath, shimsDir);
  if (fromDaemon) {
    cachedPi = { binary: fromDaemon, pathEnv: pathWithoutShims(daemonPath, shimsDir) };
    return cachedPi;
  }
  const loginPath = resolveLoginPath();
  const fromLogin = scanPathForPi(loginPath, shimsDir);
  const pathEnv = pathWithoutShims(loginPath || daemonPath, shimsDir);
  if (fromLogin) cachedPi = { binary: fromLogin, pathEnv };
  return { binary: fromLogin, pathEnv };
};
