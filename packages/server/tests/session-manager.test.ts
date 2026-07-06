import { afterEach, describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/session-manager.js";
import type { ClientSocket } from "../src/utils/ws-socket.js";
import type { ServerToClientMessage } from "../src/types.js";
import { pollFor } from "./helpers/poll-for.js";

const createFakeSocket = (): ClientSocket => ({
  readyState: 1,
  send: () => {},
  close: () => {},
});

const createManager = (graceMs: number): SessionManager =>
  new SessionManager({
    getGraceMs: () => graceMs,
    sendControl: () => {},
    hooks: {
      onOutputActivity: () => {},
      onSessionActivity: () => {},
      onSessionEvent: () => {},
      onAutomationExit: () => {},
      onClientExit: () => {},
    },
  });

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const shellInput = { shell: "/bin/sh", cwd: os.tmpdir() };

describe("SessionManager no-clients grace", { tags: ["integration"] }, () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("reaps an idle PTY whose last subscriber detaches and doesn't re-attach in time", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    // A real /bin/sh keeps emitting its prompt, which would reschedule the
    // grace forever; force idle so the reap is eligible.
    manager.markIdleForTest(spawned.id);
    expect(manager.size()).toBe(1);
    expect(manager.list()[0]?.clients).toBe(1);

    manager.detach(ws);
    // Detached → grace armed, but the PTY is still live (parked) for the window.
    expect(manager.size()).toBe(1);
    expect(manager.list()[0]?.clients).toBe(0);

    // Grace elapsed with no re-attach → reaped. No zombie.
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("cancels the grace when a subscriber re-attaches within the window", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    const sid = spawned.id;

    manager.detach(ws);
    expect(manager.size()).toBe(1);

    // A second tab joins alongside before the grace fires.
    const joining = createFakeSocket();
    const reattached = manager.attach(joining, sid);
    expect(reattached).not.toBeNull();
    expect(manager.list()[0]?.clients).toBe(1);

    await wait(150);
    // The re-attach cancelled the grace, so the PTY survived the window.
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // Now the joining tab leaves too; a fresh grace starts. Mark idle so the
    // real shell's prompt output doesn't reschedule the reap.
    manager.detach(joining);
    manager.markIdleForTest(sid);
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("keeps a dormant PTY alive while it's still producing output", async () => {
    manager = createManager(40);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.detach(ws);
    // The shell keeps producing — keep refreshing lastOutputAt within the
    // activity window across several grace intervals.
    for (let tick = 0; tick < 5; tick++) {
      await wait(20);
      manager.noteOutput(spawned.session.pid);
    }
    await wait(10);
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);
    // Output goes quiet → the next grace fires and reaps.
    manager.markIdleForTest(spawned.id);
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("keeps a dormant PTY alive while a foreground program runs quietly (alive-quiet)", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.detach(ws);

    // Output has gone quiet but a foreground program is still running — the
    // favicon would be blue (alive-quiet), not grey. The grace reap must spare
    // it so a closed tab never kills a quiet-but-running command.
    manager.markIdleForTest(spawned.id);
    manager.markForegroundForTest(spawned.id);
    await wait(150);
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // Foreground program exits → only output idleness is left (ready) → reaped.
    manager.markForegroundForTest(spawned.id, false);
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("reaps an idle /bin/sh whose pty.process aliases the shell (macOS sh→bash)", async () => {
    // Regression: on macOS /bin/sh is bash (GNU bash 3.2 in sh-mode), which
    // overrides its kernel process name at startup so node-pty's pty.process
    // reports "bash" for an idle /bin/sh while the invoked basename is "sh".
    // The shell's own settled name must read as "no foreground" — otherwise the
    // idle shell at its prompt is misreported as a running program, the
    // no-clients grace reap sees "alive-quiet" forever, and the orphaned PTY
    // never clears. Unlike the tests above, hasForeground is NOT forced off
    // here; the real ForegroundWatcher reading pty.process drives the reap
    // gate, so the alias mismatch is exercised end-to-end.
    manager = createManager(150);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    // Let the shell settle and the resolver learn "bash" as a shell name (ps
    // ucomm of pty.pid reads "bash" once bash sets its proctitle, ~+20ms).
    // ~1.4s covers the override plus the ForegroundWatcher's first polls.
    await wait(1400);

    // Force output idleness WITHOUT clearing hasForeground — the foreground
    // gate must be exercised against the real pty.process reading, not masked.
    manager.markOutputIdleForTest(spawned.id);

    // An idle shell at its prompt must read "ready", not "alive-quiet". With
    // the bug, pty.process="bash" is never recognized as the shell →
    // hasForeground stays true → alive-quiet, and the grace reap never fires.
    expect(manager.list()[0]?.state).toBe("ready");

    manager.detach(ws);
    expect(manager.size()).toBe(1);

    // Grace elapsed, state was "ready" → reaped. No zombie, no stuck orphan.
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("never reaps a dormant shell while the grace window is Off, then reaps on rearm", async () => {
    // `null` = "never reap": detaching the last viewer parks the shell with no
    // timer, so an idle shell lingers until killed from the switcher or evicted
    // at the session cap. Flipping to a finite window and calling rearmGrace()
    // (the `PUT /api/config` → applyGraceSeconds path) arms the parked shell
    // and reaps it once idle.
    let grace: number | null = null;
    manager = new SessionManager({
      getGraceMs: () => grace,
      sendControl: () => {},
      hooks: {
        onOutputActivity: () => {},
        onSessionActivity: () => {},
        onSessionEvent: () => {},
        onAutomationExit: () => {},
        onClientExit: () => {},
      },
    });
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    manager.markIdleForTest(spawned.id);
    manager.detach(ws);
    expect(manager.size()).toBe(1);

    await wait(300);
    // No timer was armed → the idle shell stays parked.
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // Flip Off → 150ms and re-arm (mirrors `PUT /api/config`).
    grace = 150;
    manager.rearmGrace();
    expect(await pollFor(() => manager.size() === 0)).toBe(true);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("still reports a real foreground program in /bin/sh (alive-quiet)", async () => {
    // Guards the fix against over-suppression: learning the shell's alias name
    // ("bash") must not absorb a genuine foreground program. A program the user
    // runs reads as a NEW name on its first poll (not in the shell set), so it's
    // reported as foreground → alive-quiet while it runs quietly.
    manager = createManager(150);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    // Settle so "bash" is learned as a shell name.
    await wait(1400);

    // Run a quiet foreground program. It reads as a NEW name ("sleep") not in
    // the shell set, so it's reported as foreground despite "bash" being learned.
    spawned.session.write("sleep 2\n");

    // sleep produces no output, so once the echo's output recency fades past the
    // activity window the state is alive-quiet (foreground running, output
    // quiet). Poll for it so the assertion absorbs the ForegroundWatcher's tick
    // and output-recency timing under load.
    let sawAliveQuiet = false;
    for (let i = 0; i < 12; i++) {
      await wait(250);
      if (manager.list()[0]?.state === "alive-quiet") {
        sawAliveQuiet = true;
        break;
      }
    }
    expect(sawAliveQuiet).toBe(true);

    // sleep exits → shell returns to prompt; output recency fades → ready.
    // Detach and the grace reap tears it down.
    await wait(3000);
    manager.detach(ws);
    await wait(400);
    expect(manager.size()).toBe(0);
    expect(spawned.session.isExited).toBe(true);
  }, 15_000);

  it("returns null when attaching to an unknown id (caller spawns fresh)", () => {
    manager = createManager(60_000);
    const ws = createFakeSocket();
    expect(manager.attach(ws, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("reports the favicon-equivalent activity state on the session list", async () => {
    manager = createManager(60_000);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    // A freshly-spawned shell just emitted its prompt — recent output → running.
    const states = manager.list().map((entry) => entry.state);
    expect(states).toContain("running");

    manager.markIdleForTest(spawned.id);
    // Idle with no foreground program → ready.
    expect(manager.list()[0]?.state).toBe("ready");
  }, 10_000);
});

describe("SessionManager pending promote", { tags: ["integration"] }, () => {
  const noopHooks = {
    onOutputActivity: () => {},
    onSessionActivity: () => {},
    onSessionEvent: () => {},
    onAutomationExit: () => {},
    onClientExit: () => {},
  };
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("sends replay-end on an auto-promote so a slow client never deadlocks in its replay window", async () => {
    // The client opens its suppressed-replay window on the {session} frame —
    // before its {ready} can race back over a slow (mobile / DERP-relayed)
    // link. When the pending timeout auto-promotes with `replay: false` it
    // must still send `replay-end`, or the client waits for a marker that
    // never comes and buffers every output frame in `replayChunks` forever
    // (a blank screen only a session-picker switch can recover).
    const sentControl: ServerToClientMessage[] = [];
    manager = new SessionManager({
      pendingPromoteTimeoutMs: 40,
      sendControl: (_ws, payload) => sentControl.push(payload),
      hooks: noopHooks,
    });
    const ws = createFakeSocket();
    manager.spawnAndAttach(ws, shellInput);
    // Never send {ready} — the pending timer auto-promotes after 40ms.
    expect(await pollFor(() => sentControl.some((message) => message.type === "replay-end"))).toBe(
      true,
    );
  }, 10_000);

  it("sends replay-end even when the client asks for no scrollback replay", () => {
    const sentControl: ServerToClientMessage[] = [];
    manager = new SessionManager({
      pendingPromoteTimeoutMs: 60_000,
      sendControl: (_ws, payload) => sentControl.push(payload),
      hooks: noopHooks,
    });
    const ws = createFakeSocket();
    manager.spawnAndAttach(ws, shellInput);
    manager.promote(ws, false);
    expect(sentControl).toContainEqual({ type: "replay-end" });
  });
});

describe("SessionManager peer-attached", { tags: ["integration"] }, () => {
  const noopHooks = {
    onOutputActivity: () => {},
    onSessionEvent: () => {},
    onAutomationExit: () => {},
    onClientExit: () => {},
    onSessionActivity: () => {},
  };
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("broadcasts peer-attached to existing clients when a second client attaches", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const first = createFakeSocket();
    const spawned = manager.spawnAndAttach(first, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    // Model the desktop having caught up (it sent {ready} on its session
    // frame long before a mobile ingests): promote it to live fan-out so the
    // peer-attached broadcast reaches it via sendControl, not its pending
    // queue.
    manager.promote(first, false);
    // A fresh spawn's first attach has no existing subscribers to notify.
    expect(sent.filter((entry) => entry.payload.type === "peer-attached")).toEqual([]);

    // A second tab joins the same live PTY (a mobile ingested the share QR).
    const second = createFakeSocket();
    manager.attach(second, spawned.id);
    const peerAttached = sent.filter((entry) => entry.payload.type === "peer-attached");
    expect(peerAttached).toHaveLength(1);
    expect(peerAttached[0].ws).toBe(first);
    expect(peerAttached[0].payload).toEqual({ type: "peer-attached" });
  });
});

describe("SessionManager pty-size", { tags: ["integration"] }, () => {
  const noopHooks = {
    onOutputActivity: () => {},
    onSessionActivity: () => {},
    onSessionEvent: () => {},
    onAutomationExit: () => {},
    onClientExit: () => {},
  };
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("leaves a lone viewer quiet — no pty-size frame on resize", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const desktop = createFakeSocket();
    manager.spawnAndAttach(desktop, shellInput);
    manager.promote(desktop, false);
    manager.resize(desktop, 120, 40);
    manager.resize(desktop, 100, 30);
    expect(sent.filter((entry) => entry.payload.type === "pty-size")).toEqual([]);
  });

  it("broadcasts the constrained size when a narrower peer joins and clears it when the peer leaves", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const desktop = createFakeSocket();
    const spawned = manager.spawnAndAttach(desktop, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.promote(desktop, false);
    manager.resize(desktop, 120, 40);
    // Lone desktop: unconstrained, so no pty-size frame.
    expect(sent.filter((entry) => entry.payload.type === "pty-size")).toEqual([]);

    // A mobile ingests the share QR and reports its narrow viewport.
    const mobile = createFakeSocket();
    manager.attach(mobile, spawned.id);
    manager.promote(mobile, false);
    manager.resize(mobile, 40, 24);
    const constrained = sent.filter(
      (entry) =>
        entry.payload.type === "pty-size" && entry.payload.cols === 40 && entry.payload.rows === 24,
    );
    // Both viewers learn the effective size — the mobile is the limiter so its
    // own grid matches (no mask); the desktop masks the dead area.
    expect(constrained.some((entry) => entry.ws === desktop)).toBe(true);
    expect(constrained.some((entry) => entry.ws === mobile)).toBe(true);

    // The mobile leaves → the desktop is unconstrained again → one clear frame
    // at the lone viewer's own size so the mask erases.
    sent.length = 0;
    manager.detach(mobile);
    expect(sent.filter((entry) => entry.payload.type === "pty-size")).toEqual([
      { ws: desktop, payload: { type: "pty-size", cols: 120, rows: 40 } },
    ]);
  });

  it("seeds a wider joiner with the current constrained size when its report doesn't change the min", () => {
    const sent: { ws: ClientSocket; payload: ServerToClientMessage }[] = [];
    manager = new SessionManager({
      sendControl: (ws, payload) => sent.push({ ws, payload }),
      hooks: noopHooks,
    });
    const desktop = createFakeSocket();
    const spawned = manager.spawnAndAttach(desktop, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.promote(desktop, false);
    manager.resize(desktop, 120, 40);
    // A mobile constrains the PTY to its narrow viewport.
    const mobile = createFakeSocket();
    manager.attach(mobile, spawned.id);
    manager.promote(mobile, false);
    manager.resize(mobile, 40, 24);
    sent.length = 0;
    // A second desktop joins — wider than the mobile's limit, so the min stays
    // 40 and recomputeResize doesn't broadcast. The joiner must still learn it's
    // constrained via the seed, or it would render no mask over its wide grid.
    const secondDesktop = createFakeSocket();
    manager.attach(secondDesktop, spawned.id);
    manager.promote(secondDesktop, false);
    manager.resize(secondDesktop, 120, 40);
    const seeded = sent.filter(
      (entry) =>
        entry.ws === secondDesktop &&
        entry.payload.type === "pty-size" &&
        entry.payload.cols === 40 &&
        entry.payload.rows === 24,
    );
    expect(seeded.length).toBeGreaterThan(0);
  });
});

describe("SessionManager sessionsInPath", { tags: ["integration"] }, () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  // A spawned PTY with no client is still "live" — it sits in the registry
  // until killed or reaped, the same shape as a dormant PTY parked in the
  // no-clients grace window. sessionsInPath reads the registry, so it covers
  // attached, dormant, and automation PTYs alike.
  it("reports a live PTY whose cwd is inside the target, and nothing for an unrelated path", () => {
    manager = createManager(60_000);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-guard-"));
    const siblingDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-sibling-"));
    try {
      const spawned = manager.spawn({ shell: "/bin/sh", cwd: worktreeDir });
      expect(spawned).not.toBeNull();
      if (!spawned) return;

      const onWorktree = manager.sessionsInPath(worktreeDir);
      expect(onWorktree).toHaveLength(1);
      expect(onWorktree[0].id).toBe(spawned.id);
      expect(manager.sessionsInPath(siblingDir)).toHaveLength(0);
    } finally {
      manager?.disposeAll();
      fs.rmSync(worktreeDir, { recursive: true, force: true });
      fs.rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  it("still reports a PTY that has detached and parked with no clients (dormant)", () => {
    manager = createManager(60_000);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-dormant-"));
    try {
      const ws = createFakeSocket();
      const spawned = manager.spawnAndAttach(ws, { shell: "/bin/sh", cwd: worktreeDir });
      expect(spawned).not.toBeNull();
      if (!spawned) return;

      // Last client leaves → the PTY parks with no clients (dormant) for the
      // grace window. It's still a live process the session picker can re-attach
      // to, so a worktree removal must stay blocked.
      manager.detach(ws);
      expect(manager.size()).toBe(1);
      expect(manager.sessionsInPath(worktreeDir)).toHaveLength(1);
    } finally {
      manager?.disposeAll();
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("matches a shell in a subdirectory of the worktree (containment)", () => {
    manager = createManager(60_000);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-parent-"));
    const subDir = path.join(worktreeDir, "sub");
    fs.mkdirSync(subDir);
    try {
      const spawned = manager.spawn({ shell: "/bin/sh", cwd: subDir });
      expect(spawned).not.toBeNull();
      expect(manager.sessionsInPath(worktreeDir)).toHaveLength(1);
    } finally {
      manager?.disposeAll();
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("does not match a shell in the worktree for a sub-path of it", () => {
    manager = createManager(60_000);
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-child-"));
    const subDir = path.join(worktreeDir, "sub");
    fs.mkdirSync(subDir);
    try {
      const spawned = manager.spawn({ shell: "/bin/sh", cwd: worktreeDir });
      expect(spawned).not.toBeNull();
      expect(manager.sessionsInPath(subDir)).toHaveLength(0);
    } finally {
      manager?.disposeAll();
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("does not match a sibling whose name only shares a prefix", () => {
    manager = createManager(60_000);
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "wt-prefix-"));
    const target = path.join(base, "foo");
    const sibling = path.join(base, "foobar");
    fs.mkdirSync(target);
    fs.mkdirSync(sibling);
    try {
      const spawned = manager.spawn({ shell: "/bin/sh", cwd: sibling });
      expect(spawned).not.toBeNull();
      expect(manager.sessionsInPath(target)).toHaveLength(0);
    } finally {
      manager?.disposeAll();
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
