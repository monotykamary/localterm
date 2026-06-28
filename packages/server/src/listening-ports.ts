import { execFile } from "node:child_process";
import { type ProcessSnapshotEntry } from "./caffeinate-process-match.js";
import { LSOF_LISTEN_MAX_BUFFER_BYTES, LSOF_LISTEN_TIMEOUT_MS, TCP_PORT_MAX } from "./constants.js";

// One listening TCP socket parsed out of `lsof -nP -iTCP -sTCP:LISTEN`. `pid` is
// the process holding the socket (a descendant of a session shell), `port` is
// the listened port, `address` is the bind address lsof printed (`*` for a
// wildcard / all-interfaces bind, `127.0.0.1` / `[::1]` for loopback), and
// `processName` is lsof's COMMAND column (the kernel comm, e.g. `node`).
export interface ListeningSocketEntry {
  pid: number;
  port: number;
  address: string;
  processName: string;
}

export type SnapshotListeners = () => Promise<ListeningSocketEntry[]>;

// A listening port resolved to the localterm session it descends from. The
// route maps `sessionPid` to the session's id/title/cwd for the wire shape.
export interface SessionListeningPort {
  port: number;
  address: string;
  pid: number;
  processName: string;
  sessionPid: number;
}

// Map every pid in the union of the session-shell subtrees to the session pid
// that owns it (the root it descends from). The session pids map to themselves.
// A dev server has exactly one session ancestor in practice; BFS assigns the
// first session that reaches a shared descendant, which only matters for the
// pathological case of two sessions sharing a descendant.
const buildDescendantOwnerMap = (
  sessionPids: readonly number[],
  snapshot: readonly ProcessSnapshotEntry[],
): Map<number, number> => {
  const ownerByPid = new Map<number, number>();
  if (sessionPids.length === 0) return ownerByPid;
  const childrenByParent = new Map<number, ProcessSnapshotEntry[]>();
  for (const entry of snapshot) {
    const list = childrenByParent.get(entry.ppid);
    if (list) list.push(entry);
    else childrenByParent.set(entry.ppid, [entry]);
  }
  for (const pid of sessionPids) ownerByPid.set(pid, pid);
  const queue: number[] = [...sessionPids];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    const owner = ownerByPid.get(pid) ?? pid;
    const children = childrenByParent.get(pid);
    if (!children) continue;
    for (const child of children) {
      if (ownerByPid.has(child.pid)) continue;
      ownerByPid.set(child.pid, owner);
      queue.push(child.pid);
    }
  }
  return ownerByPid;
};

// Display priority for collapsing dual-stack duplicates of one (pid, port): a
// wildcard bind (`*` / `[::]`) is the most useful to surface, then loopback,
// then a specific interface.
const addressPriority = (address: string): number => {
  if (address === "*" || address === "[::]") return 0;
  if (address === "127.0.0.1" || address === "localhost" || address === "[::1]") return 1;
  return 2;
};

// Keep only listening sockets whose owning pid lives under a localterm session
// shell. Collapses dual-stack duplicates (one pid listening on the same port
// over IPv4 and IPv6) to a single row, preferring the wildcard `*` address so
// the modal shows "all interfaces" over a loopback-only entry. Returns ports
// sorted by port then pid for a stable order.
export const listSessionListeningPorts = (
  sessionPids: readonly number[],
  snapshot: readonly ProcessSnapshotEntry[],
  listeners: readonly ListeningSocketEntry[],
): SessionListeningPort[] => {
  if (sessionPids.length === 0 || listeners.length === 0) return [];
  const ownerByPid = buildDescendantOwnerMap(sessionPids, snapshot);
  const deduped = new Map<string, SessionListeningPort>();
  for (const socket of listeners) {
    const sessionPid = ownerByPid.get(socket.pid);
    if (sessionPid === undefined) continue;
    const key = `${socket.pid}:${socket.port}`;
    const existing = deduped.get(key);
    if (existing && addressPriority(existing.address) <= addressPriority(socket.address)) {
      continue;
    }
    deduped.set(key, {
      port: socket.port,
      address: socket.address,
      pid: socket.pid,
      processName: socket.processName,
      sessionPid,
    });
  }
  return [...deduped.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
};

// True when `pid` is a session shell pid or any of its descendants. The kill
// route re-verifies this against a fresh snapshot before signalling so a pid
// recycled after the dev server exited can't be killed by a stale request.
export const isSessionDescendantPid = (
  sessionPids: readonly number[],
  pid: number,
  snapshot: readonly ProcessSnapshotEntry[],
): boolean => buildDescendantOwnerMap(sessionPids, snapshot).has(pid);

// lsof's NAME column prints `host:port` (or `*:port` for a wildcard bind,
// `[ipv6]:port` for IPv6). The port lives after the final `:` so an IPv6
// bracketed host splits cleanly. The `(LISTEN)` state token — present with
// `-sTCP:LISTEN` — sits to the right of NAME, so the NAME is the rightmost
// token matching `host:port`.
const NAME_PORT_RE = /^(.+):(\d+)$/;

export const parseLsofLine = (line: string): ListeningSocketEntry | null => {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 5) return null;
  const pid = Number(tokens[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const processName = tokens[0];
  // The NAME column is the last token before the optional `(LISTEN)` state
  // suffix, so the rightmost non-state token is the `host:port` we want.
  let name: string | null = null;
  for (let index = tokens.length - 1; index >= 2; index -= 1) {
    const token = tokens[index];
    if (token === "(LISTEN)") continue;
    if (NAME_PORT_RE.test(token)) name = token;
    break;
  }
  if (name === null) return null;
  const colon = name.lastIndexOf(":");
  const port = Number(name.slice(colon + 1));
  if (!Number.isInteger(port) || port < 1 || port > TCP_PORT_MAX) return null;
  const address = name.slice(0, colon) || "*";
  return { pid, port, address, processName };
};

// Default snapshot: a single `lsof` listing of every listening TCP socket on
// the machine, parsed to {pid, port, address, processName}. `-n`/`-P` keep IPs
// and port numbers (no DNS/service lookups) so parsing is deterministic.
// Resolves to [] on any failure (lsof missing, slow, or running out of buffer)
// so the ports modal just shows nothing instead of erroring.
export const defaultSnapshotListeners: SnapshotListeners = () =>
  new Promise((resolve) => {
    execFile(
      "lsof",
      ["-nP", "-iTCP", "-sTCP:LISTEN"],
      { maxBuffer: LSOF_LISTEN_MAX_BUFFER_BYTES, timeout: LSOF_LISTEN_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const entries: ListeningSocketEntry[] = [];
        for (const line of stdout.split("\n")) {
          // lsof's header row starts with "COMMAND"; skip it rather than risk
          // parsing a column label as a port.
          if (!line || line.startsWith("COMMAND")) continue;
          const entry = parseLsofLine(line);
          if (entry) entries.push(entry);
        }
        resolve(entries);
      },
    );
  });
