import { describe, expect, it } from "vite-plus/test";
import type { ProcessSnapshotEntry } from "../src/caffeinate-process-match.js";
import {
  isSessionDescendantPid,
  listSessionListeningPorts,
  parseLsofLine,
  type ListeningSocketEntry,
} from "../src/listening-ports.js";

const snapshot: ProcessSnapshotEntry[] = [
  { pid: 100, ppid: 1, command: "-zsh" },
  { pid: 200, ppid: 100, command: "npm run dev" },
  { pid: 300, ppid: 200, command: "node /usr/local/bin/vite" },
  { pid: 400, ppid: 100, command: "python -m http.server" },
  { pid: 500, ppid: 1, command: "node /usr/local/bin/vite" }, // not under any session
  { pid: 600, ppid: 999, command: "ruby server.rb" }, // orphan, no session ancestor
];

const listeners: ListeningSocketEntry[] = [
  { pid: 300, port: 5173, address: "*", processName: "node" }, // vite (deep descendant of 100)
  { pid: 400, port: 8000, address: "127.0.0.1", processName: "python3" }, // direct child of 100
  { pid: 500, port: 5173, address: "*", processName: "node" }, // not under a session
  { pid: 600, port: 9292, address: "127.0.0.1", processName: "ruby" }, // no session ancestor
];

describe("listSessionListeningPorts", () => {
  it("keeps listeners owned by descendants of a session shell", () => {
    const ports = listSessionListeningPorts([100], snapshot, listeners);
    const portsByPort = new Map(ports.map((port) => [port.port, port]));
    expect(portsByPort.get(5173)?.sessionPid).toBe(100);
    expect(portsByPort.get(8000)?.sessionPid).toBe(100);
  });

  it("walks deeper descendants, not just direct children", () => {
    const ports = listSessionListeningPorts([100], snapshot, listeners);
    // vite (pid 300) is a grandchild of the shell (100 -> 200 -> 300).
    expect(ports.find((port) => port.pid === 300)?.sessionPid).toBe(100);
  });

  it("ignores a listener not under any session", () => {
    const ports = listSessionListeningPorts([100], snapshot, listeners);
    expect(ports.find((port) => port.pid === 500)).toBeUndefined();
    expect(ports.find((port) => port.pid === 600)).toBeUndefined();
  });

  it("returns an empty list with no sessions or no listeners", () => {
    expect(listSessionListeningPorts([], snapshot, listeners)).toEqual([]);
    expect(listSessionListeningPorts([100], snapshot, [])).toEqual([]);
  });

  it("sorts by port then pid for a stable order", () => {
    const ports = listSessionListeningPorts([100], snapshot, listeners);
    expect(ports.map((port) => port.port)).toEqual([5173, 8000]);
  });

  it("collapses dual-stack duplicates of one (pid, port), preferring the wildcard address", () => {
    const dualStack: ListeningSocketEntry[] = [
      { pid: 300, port: 5173, address: "127.0.0.1", processName: "node" },
      { pid: 300, port: 5173, address: "[::1]", processName: "node" },
      { pid: 300, port: 5173, address: "*", processName: "node" },
    ];
    const ports = listSessionListeningPorts([100], snapshot, dualStack);
    expect(ports).toHaveLength(1);
    expect(ports[0].address).toBe("*");
  });

  it("keeps the first seen address when no wildcard is present", () => {
    const loopbackOnly: ListeningSocketEntry[] = [
      { pid: 300, port: 5173, address: "127.0.0.1", processName: "node" },
      { pid: 300, port: 5173, address: "[::1]", processName: "node" },
    ];
    const ports = listSessionListeningPorts([100], snapshot, loopbackOnly);
    expect(ports).toHaveLength(1);
    expect(ports[0].address).toBe("127.0.0.1");
  });

  it("treats a listener on the session shell pid itself as owned by that session", () => {
    const ownPid: ListeningSocketEntry[] = [
      { pid: 100, port: 4444, address: "*", processName: "zsh" },
    ];
    const ports = listSessionListeningPorts([100], snapshot, ownPid);
    expect(ports).toHaveLength(1);
    expect(ports[0].sessionPid).toBe(100);
  });
});

describe("isSessionDescendantPid", () => {
  it("is true for a session shell pid", () => {
    expect(isSessionDescendantPid([100], 100, snapshot)).toBe(true);
  });

  it("is true for a deep descendant", () => {
    expect(isSessionDescendantPid([100], 300, snapshot)).toBe(true);
  });

  it("is false for an unrelated pid", () => {
    expect(isSessionDescendantPid([100], 500, snapshot)).toBe(false);
  });

  it("is false when the pid is not in the snapshot at all", () => {
    expect(isSessionDescendantPid([100], 77777, snapshot)).toBe(false);
  });
});

describe("parseLsofLine", () => {
  it("parses an IPv4 loopback listener", () => {
    expect(
      parseLsofLine("node    8301 alice   21u  IPv4 0x123  0t0  TCP 127.0.0.1:5173 (LISTEN)"),
    ).toEqual({
      pid: 8301,
      port: 5173,
      address: "127.0.0.1",
      processName: "node",
    });
  });

  it("parses a wildcard (all-interfaces) listener", () => {
    expect(parseLsofLine("vite    8302 alice   22u  IPv6 0x456  0t0  TCP *:3000 (LISTEN)")).toEqual(
      {
        pid: 8302,
        port: 3000,
        address: "*",
        processName: "vite",
      },
    );
  });

  it("parses an IPv6 bracketed loopback listener", () => {
    expect(
      parseLsofLine("node    8303 alice   23u  IPv6 0x789  0t0  TCP [::1]:5173 (LISTEN)"),
    ).toEqual({
      pid: 8303,
      port: 5173,
      address: "[::1]",
      processName: "node",
    });
  });

  it("skips the lsof header row and short lines", () => {
    expect(parseLsofLine("COMMAND   PID   USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME")).toBeNull();
    expect(parseLsofLine("")).toBeNull();
    expect(parseLsofLine("node 8304")).toBeNull();
  });
});
