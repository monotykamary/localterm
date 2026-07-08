import { describe, expect, it, vi } from "vite-plus/test";
import { execFileSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  // shell-process-name.ts reads tpgid via execFileSync; return a controllable
  // foreground group id so the shell-idle decision is deterministic without a
  // real PTY or process-group introspection.
  execFileSync: vi.fn(),
}));

import { confirmShellProcessName } from "../src/utils/shell-process-name.js";

// Mirrors Session.inferForegroundProcess's caller logic so the cache-poisoning
// race is exercised end-to-end without a real PTY: an unknown name is the shell
// (null) only when confirmShellProcessName returns the same name; any other
// confirmed value is a learned shell alias added to the fast-path set, and a
// still-unknown name is a real foreground program returned as-is.
const inferForeground = (
  shellProcessNames: Set<string>,
  shellPath: string,
  pid: number,
  raw: string,
  readForegroundComm: () => string,
): string | null => {
  if (!raw) return null;
  if (shellProcessNames.has(raw)) return null;
  const confirmed = confirmShellProcessName(shellPath, pid, readForegroundComm);
  if (confirmed) {
    shellProcessNames.add(confirmed);
    if (confirmed === raw) return null;
  }
  return raw;
};

describe("confirmShellProcessName", () => {
  const mockTpgid = (tpgid: number): void => {
    vi.mocked(execFileSync).mockReturnValue(`${tpgid}\n`);
  };

  it("does not cache a foreground program that exits before the tpgid read (TOCTOU race)", () => {
    // At poll start pty.process read "node" (a `pnpm`/`pi`-style program was
    // foreground), but it exited in the ~5-20ms window before the tpgid read,
    // leaving the shell idle (tpgid == pid). The re-read of pty.process now
    // returns the shell's comm ("zsh"), so the cache must learn "zsh" — not
    // the just-exited program's "node" — or every later run of a `node`-based
    // program is permanently misread as the idle shell across every session.
    mockTpgid(99999); // tpgid == pid → shell idle
    const shellProcessNames = new Set(["zsh", "/bin/uniq-zsh-race"]);
    const result = inferForeground(
      shellProcessNames,
      "/bin/uniq-zsh-race",
      99999,
      "node",
      () => "zsh",
    );
    // The shell is actually idle; the stale "node" surfaces for one poll
    // (harmless). The point is the cache learned "zsh", not "node".
    expect(result).toBe("node");

    // A later foreground `node` program must still be detected as foreground,
    // not swallowed as the shell. With the bug, "node" was cached → filtered.
    mockTpgid(99990); // tpgid != pid → a program is foreground
    const detected = inferForeground(
      shellProcessNames,
      "/bin/uniq-zsh-race",
      99999,
      "node",
      () => "node",
    );
    expect(detected).toBe("node");
  });

  it("still learns an aliased shell's idle comm (/bin/sh reports bash)", () => {
    mockTpgid(88888); // shell idle
    const shellProcessNames = new Set(["sh", "/bin/uniq-sh-alias"]);
    const result = inferForeground(
      shellProcessNames,
      "/bin/uniq-sh-alias",
      88888,
      "bash",
      () => "bash",
    );
    expect(result).toBe(null);
    expect(shellProcessNames.has("bash")).toBe(true);
  });

  it("does not learn a name while a foreground program is running (tpgid != pid)", () => {
    mockTpgid(77770); // tpgid != pid → program foreground
    const shellProcessNames = new Set(["zsh", "/bin/uniq-zsh-prog"]);
    const result = inferForeground(
      shellProcessNames,
      "/bin/uniq-zsh-prog",
      77777,
      "vim",
      () => "vim",
    );
    expect(result).toBe("vim");
    expect(shellProcessNames.has("vim")).toBe(false);
  });
});
