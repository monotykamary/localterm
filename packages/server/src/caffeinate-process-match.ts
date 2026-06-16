import { execFile } from "node:child_process";

export interface ProcessSnapshotEntry {
  pid: number;
  ppid: number;
  command: string;
}

export type SnapshotProcesses = () => Promise<ProcessSnapshotEntry[]>;

const SCRIPT_EXTENSION_RE = /\.(js|mjs|cjs|ts|tsx|jsx|py|sh|pl|rb)$/i;

const firstMatchingTrigger = (raw: string, triggers: ReadonlySet<string>): string | null => {
  const lowered = raw.toLowerCase();
  if (triggers.has(lowered)) return lowered;
  const stripped = lowered.replace(SCRIPT_EXTENSION_RE, "");
  if (stripped !== lowered && stripped && triggers.has(stripped)) return stripped;
  return null;
};

// True when any whitespace-separated token of `command` has a basename (or
// any directory segment of its path) equal to a trigger. Matching strategy:
//   1. basename exact
//   2. basename with common script extension stripped  (`codex.js` -> `codex`)
//   3. any full `/`-delimited path segment exact         (`claude/versions/2.1.178` -> `claude`)
// Token-basename matching lets `node /opt/homebrew/bin/claude` count as
// `claude` while keeping short triggers like `pi` from matching substrings of
// unrelated paths. Path-segment matching catches real-world package layouts
// where the binary basename is the resolved version number or a `.js` shim.
export const commandMatchesTriggers = (
  command: string,
  triggers: ReadonlySet<string>,
): string | null => {
  if (triggers.size === 0) return null;
  for (const token of command.split(/\s+/)) {
    if (!token) continue;
    const slash = token.lastIndexOf("/");
    const base = slash === -1 ? token : token.slice(slash + 1);
    const match = firstMatchingTrigger(base, triggers);
    if (match) return match;
    if (slash !== -1) {
      for (const segment of token.slice(0, slash).split("/")) {
        const segmentMatch = firstMatchingTrigger(segment, triggers);
        if (segmentMatch) return segmentMatch;
      }
    }
  }
  return null;
};

// Walk the process tree rooted at each session shell pid and report whether any
// descendant's command line matches a trigger. The shell pids themselves are
// roots (their command is just the shell) and never matched directly.
export const anySessionRunsTrigger = (
  sessionPids: readonly number[],
  snapshot: readonly ProcessSnapshotEntry[],
  triggers: ReadonlySet<string>,
): string | null => {
  if (sessionPids.length === 0 || triggers.size === 0) return null;
  const childrenByParent = new Map<number, ProcessSnapshotEntry[]>();
  for (const entry of snapshot) {
    const list = childrenByParent.get(entry.ppid);
    if (list) list.push(entry);
    else childrenByParent.set(entry.ppid, [entry]);
  }
  const visited = new Set<number>(sessionPids);
  const queue: number[] = [...sessionPids];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    const children = childrenByParent.get(pid);
    if (!children) continue;
    for (const child of children) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      const matched = commandMatchesTriggers(child.command, triggers);
      if (matched) return matched;
      queue.push(child.pid);
    }
  }
  return null;
};

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(.*)$/;

// Default snapshot: a single `ps` listing of every process with its pid, ppid,
// and full command line. The command may be truncated to terminal width, but
// only the leading binary token matters for matching, so trailing-arg loss is
// harmless. Resolves to [] on any failure (caffeinate just stays as-is).
export const defaultSnapshotProcesses: SnapshotProcesses = () =>
  new Promise((resolve) => {
    execFile(
      "ps",
      ["-A", "-o", "pid=,ppid=,command="],
      { maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const entries: ProcessSnapshotEntry[] = [];
        for (const line of stdout.split("\n")) {
          const match = PS_LINE.exec(line);
          if (!match) continue;
          entries.push({
            pid: Number(match[1]),
            ppid: Number(match[2]),
            command: match[3],
          });
        }
        resolve(entries);
      },
    );
  });
