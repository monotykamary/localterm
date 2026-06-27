import { execFileSync } from "node:child_process";

// Confirms whether a process name pty.process just reported is the shell itself
// at idle (vs a genuine foreground program), and if so returns the shell's
// alias name so the caller can learn it.
//
// On macOS node-pty reports kp_proc.p_comm, which an aliased shell overrides
// after startup: /bin/sh is bash, so an idle /bin/sh reports "bash" — not the
// invoked basename "sh" — which the basename-only foreground check misread as
// a running program. The robust discriminator is the terminal's foreground
// process group, not the name: the shell is its own process-group leader and
// holds the terminal at idle (tcgetpgrp == pty.pid), while a foreground program
// runs in its own group (tcgetpgrp != pty.pid). `ps -o tpgid= -p <pty.pid>`
// reads that foreground group id; when it equals pty.pid the current reading is
// the shell, and the caller learns whatever name the shell reports ("bash") —
// no separate name lookup, no proctitle-timing race, no polling that a
// short-lived session could poison by dying mid-read.
//
// The confirmed name is a function of the shell binary, so it's cached per
// shell path: the sync ps runs at most once per aliased path per process
// lifetime (the very first idle mismatch), then every later session and every
// later poll reads the cache. A non-aliased shell (zsh/bash) never mismatches,
// so it never reaches here. A genuine program (tpgid != pty.pid) is not
// cached, so the next mismatch re-checks instead of inheriting a stale answer.
// macOS-only: Linux node-pty reads /proc/<pgrp>/cmdline (the invoked name,
// already in the caller's set).
const confirmedByShellPath = new Map<string, string>();

export const confirmShellProcessName = (
  shellPath: string,
  pid: number,
  candidate: string,
): string | null => {
  const cached = confirmedByShellPath.get(shellPath);
  if (cached !== undefined) return cached;
  let isShell = false;
  try {
    const tpgid = Number.parseInt(
      execFileSync("ps", ["-o", "tpgid=", "-p", String(pid)], {
        timeout: 1_000,
        encoding: "utf8",
      }).trim(),
      10,
    );
    // The shell is the foreground process-group leader holding the terminal at
    // idle, so its foreground group id equals its own pid. A foreground program
    // runs in its own group, so tpgid differs.
    isShell = Number.isInteger(tpgid) && tpgid === pid;
  } catch {
    isShell = false;
  }
  if (!isShell) return null;
  confirmedByShellPath.set(shellPath, candidate);
  return candidate;
};
